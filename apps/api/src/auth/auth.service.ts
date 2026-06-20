import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SiwsService } from './siws.service';
import { PrivyService } from './privy.service';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, randomBytes } from 'node:crypto';
import { hashRefreshToken, newJti, newRefreshToken, parseTtlMs } from './session-tokens';

/** Request metadata captured on the Session row for audit / logout UIs. */
export interface SessionContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Owns the full sign-in flow:
 *   1. Issue a nonce for the wallet.
 *   2. Verify the signed nonce against the wallet's ed25519 key.
 *   3. Find-or-create the User row (first sign-in auto-provisions).
 *   4. Sign a JWT carrying both userId and walletAddress so downstream
 *      guards don't need to hit the DB on every request.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly siws: SiwsService,
    private readonly privy: PrivyService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  requestNonce(walletAddress: string) {
    return this.siws.issueNonce(walletAddress);
  }

  async verifyAndIssueToken(
    params: {
      walletAddress: string;
      nonce: string;
      signature: string;
      message: string;
      ref?: string;
    },
    ctx: SessionContext = {},
  ) {
    const ok = await this.siws.verifySignature(params);
    if (!ok) throw new UnauthorizedException('Invalid signature');

    const user = await this.upsertUser(params.walletAddress, {
      ref: params.ref,
      ipAddress: ctx.ipAddress,
    });
    return this.gateAndIssue(user, ctx);
  }

  /**
   * Privy social login (#203). The Privy access token — NOT any client-supplied
   * identity — is the gate: it's verified cryptographically server-side, then the
   * Privy user id + linked Google/Apple email are sourced from Privy. We then
   * find-or-create a `User` (`authProvider='privy'`) and issue the SAME app
   * access+refresh pair as SIWS, so every downstream guard/store is unchanged.
   */
  async verifyPrivyAndIssueToken(
    params: { accessToken: string; ref?: string },
    ctx: SessionContext = {},
  ) {
    const identity = await this.privy.verifyPrivyToken(params.accessToken);
    const user = await this.upsertPrivyUser(identity, {
      ref: params.ref,
      ipAddress: ctx.ipAddress,
    });
    return this.gateAndIssue(user, ctx);
  }

  /**
   * Shared post-verification path for BOTH SIWS and Privy: enforce the standing
   * gates (ban / self-exclusion #37/#46), mint the session, and shape the
   * response identically so the frontend store is provider-agnostic.
   */
  private async gateAndIssue(
    user: {
      id: string;
      walletAddress: string;
      username: string | null;
      avatarUrl: string | null;
      refCode: string;
      banned: boolean;
      selfExcludedUntil: Date | null;
      createdAt: Date;
    },
    ctx: SessionContext,
  ) {
    // Banned users must not mint tokens/sessions (#37) — a valid signature/token
    // only proves identity, not standing.
    if (user.banned) throw new ForbiddenException('Account banned');
    // Self-exclusion (#46) hard-blocks login for its duration; cooling-off does
    // NOT (the user may sign in to manage settings — wagering is gated at the
    // bet endpoints via assertCanWager).
    if (user.selfExcludedUntil && user.selfExcludedUntil > new Date()) {
      throw new ForbiddenException('Account self-excluded');
    }
    const { accessToken, refreshToken } = await this.issueSession(user.id, user.walletAddress, ctx);

    return {
      accessToken,
      refreshToken,
      walletAddress: user.walletAddress,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        username: user.username,
        avatarUrl: user.avatarUrl,
        refCode: user.refCode,
        createdAt: user.createdAt.toISOString(),
      },
    };
  }

  private refreshTtlMs(): number {
    return parseTtlMs(this.config.get<string>('JWT_REFRESH_TTL'));
  }

  /** Mint an access+refresh pair and persist a fresh Session row for them. */
  private async issueSession(
    userId: string,
    walletAddress: string,
    ctx: SessionContext,
  ): Promise<IssuedTokens> {
    const jti = newJti();
    const refreshToken = newRefreshToken();
    const accessToken = await this.jwt.signAsync({
      sub: userId,
      userId,
      walletAddress,
      typ: 'access',
      jti,
    });
    await this.prisma.session.create({
      data: {
        userId,
        jwtId: jti,
        refreshToken: hashRefreshToken(refreshToken),
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
        expiresAt: new Date(Date.now() + this.refreshTtlMs()),
      },
    });
    return { accessToken, refreshToken };
  }

  /**
   * Rotate a refresh token (#35): validate it against the stored hash, then
   * issue a NEW access+refresh pair on the SAME session (new jti invalidates the
   * old access token). The old refresh token is rejected on next use, and
   * replaying an already-rotated token is treated as theft → the session is
   * revoked entirely.
   */
  async refresh(rawRefreshToken: string, ctx: SessionContext = {}): Promise<IssuedTokens> {
    if (!rawRefreshToken) throw new UnauthorizedException('Missing refresh token');
    const hash = hashRefreshToken(rawRefreshToken);

    const current = await this.prisma.session.findUnique({
      where: { refreshToken: hash },
      include: { user: { select: { walletAddress: true } } },
    });
    if (current) {
      if (current.expiresAt.getTime() < Date.now()) {
        await this.prisma.session.delete({ where: { id: current.id } }).catch(() => undefined);
        throw new UnauthorizedException('Refresh token expired');
      }
      // Self-excluded users cannot mint new access tokens (#46) — kill the
      // session so the exclusion can't be outlived by the refresh window.
      const excl = await this.prisma.user.findUnique({
        where: { id: current.userId },
        select: { selfExcludedUntil: true },
      });
      if (excl?.selfExcludedUntil && excl.selfExcludedUntil > new Date()) {
        await this.prisma.session.delete({ where: { id: current.id } }).catch(() => undefined);
        throw new ForbiddenException('Account self-excluded');
      }
      const jti = newJti();
      const refreshToken = newRefreshToken();
      const accessToken = await this.jwt.signAsync({
        sub: current.userId,
        userId: current.userId,
        walletAddress: current.user.walletAddress,
        typ: 'access',
        jti,
      });
      await this.prisma.session.update({
        where: { id: current.id },
        data: {
          jwtId: jti,
          prevRefreshToken: current.refreshToken, // remember the rotated-out hash
          refreshToken: hashRefreshToken(refreshToken),
          userAgent: ctx.userAgent ?? current.userAgent,
          ipAddress: ctx.ipAddress ?? current.ipAddress,
          expiresAt: new Date(Date.now() + this.refreshTtlMs()),
        },
      });
      return { accessToken, refreshToken };
    }

    // Reuse detection: the token matches an already-rotated hash → theft signal →
    // revoke the whole session.
    const replayed = await this.prisma.session.findFirst({ where: { prevRefreshToken: hash } });
    if (replayed) {
      await this.prisma.session.delete({ where: { id: replayed.id } }).catch(() => undefined);
      throw new UnauthorizedException('Refresh token reuse detected — session revoked');
    }

    throw new UnauthorizedException('Invalid refresh token');
  }

  /** Log out the current session (by the access token's jti). */
  async logout(jti: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { jwtId: jti } });
  }

  /** Log out everywhere — delete every session for the user. */
  async logoutAll(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  /**
   * Find the user by wallet address or create a fresh row. Handles the race
   * where two concurrent first-sign-ins for the same wallet both try to
   * insert by catching the unique-constraint violation and re-reading.
   */
  private async upsertUser(
    walletAddress: string,
    opts: { ref?: string; ipAddress?: string | null } = {},
  ) {
    const existing = await this.prisma.user.findUnique({ where: { walletAddress } });
    if (existing) return existing;

    // Multi-wallet: a non-primary linked address resolves to its owner.
    const linked = await this.prisma.linkedWallet.findUnique({
      where: { address: walletAddress },
      include: { user: true },
    });
    if (linked) return linked.user;

    // First-ever sign-in: capture a salted signup IP-hash and resolve an
    // optional referral code, rejecting self-referral (#47).
    const signupIpHash = this.hashIp(opts.ipAddress ?? null);
    const referredById = await this.resolveReferrer(opts.ref, {
      excludeWalletAddress: walletAddress,
    });

    try {
      return await this.prisma.user.create({
        data: {
          walletAddress,
          refCode: this.generateRefCode(),
          signupIpHash,
          referredById,
        },
      });
    } catch {
      // Unique violation race — re-read and return the winner
      const retry = await this.prisma.user.findUnique({ where: { walletAddress } });
      if (retry) return retry;
      throw new Error('Failed to provision user');
    }
  }

  /**
   * Find the Privy user by `privyUserId` or create a fresh row, mirroring the
   * SIWS `upsertUser` semantics (refCode, salted signup IP, referral resolution,
   * unique-race retry) so a Privy account is provisioned IDENTICALLY to a wallet
   * account — same balances seed (schema default), same `Bet`/engine eligibility.
   *
   * Differences from SIWS: `authProvider='privy'`, `privyUserId` is set, the
   * linked Google/Apple email is recorded, and `walletAddress` is either the
   * user's linked Solana address (if any) or a unique non-signable placeholder
   * (`privy:<did>`) — Privy social users may have no external wallet, but the
   * column is `@unique`+NOT NULL and the JWT carries it. The placeholder is NOT a
   * valid base58 Solana key, so it can never collide with a real SIWS wallet.
   */
  private async upsertPrivyUser(
    identity: {
      privyUserId: string;
      email: string | null;
      emailProvider: 'google' | 'apple' | 'email' | null;
      solanaAddress: string | null;
    },
    opts: { ref?: string; ipAddress?: string | null } = {},
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { privyUserId: identity.privyUserId },
    });
    if (existing) return existing;

    const walletAddress = identity.solanaAddress ?? `privy:${identity.privyUserId}`;
    const signupIpHash = this.hashIp(opts.ipAddress ?? null);
    const referredById = await this.resolveReferrer(opts.ref, {
      excludePrivyUserId: identity.privyUserId,
    });

    try {
      return await this.prisma.user.create({
        data: {
          walletAddress,
          authProvider: 'privy',
          privyUserId: identity.privyUserId,
          email: identity.email,
          googleAccount: identity.emailProvider === 'google' ? identity.email : null,
          refCode: this.generateRefCode(),
          signupIpHash,
          referredById,
        },
      });
    } catch {
      // Unique violation race (two concurrent first-logins for the same Privy
      // user) — re-read and return the winner.
      const retry = await this.prisma.user.findUnique({
        where: { privyUserId: identity.privyUserId },
      });
      if (retry) return retry;
      throw new Error('Failed to provision Privy user');
    }
  }

  /**
   * Resolve an optional referral code to a referrer id, rejecting self-referral
   * (#47). Shared by the SIWS and Privy provisioning paths.
   */
  private async resolveReferrer(
    ref: string | undefined,
    exclude: { excludeWalletAddress?: string; excludePrivyUserId?: string },
  ): Promise<string | null> {
    if (!ref) return null;
    const referrer = await this.prisma.user.findUnique({
      where: { refCode: ref },
      select: { id: true, walletAddress: true, privyUserId: true },
    });
    if (!referrer) return null;
    if (exclude.excludeWalletAddress && referrer.walletAddress === exclude.excludeWalletAddress) {
      return null;
    }
    if (exclude.excludePrivyUserId && referrer.privyUserId === exclude.excludePrivyUserId) {
      return null;
    }
    return referrer.id;
  }

  /** Salted SHA-256 of the signup IP (#47) — raw IPs are never stored. */
  private hashIp(ip: string | null): string | null {
    if (!ip) return null;
    const salt = this.config.get<string>('GEO_IP_SALT') ?? 'scadium-dev-geo-salt-INSECURE';
    return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
  }

  private generateRefCode(): string {
    // 8-char alphanumeric — collision probability negligible at platform
    // size; we still have a unique index enforcing it at the DB level.
    return randomBytes(6).toString('base64url').slice(0, 8).toUpperCase();
  }
}
