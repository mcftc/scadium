import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SiwsService } from './siws.service';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'node:crypto';
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
    },
    ctx: SessionContext = {},
  ) {
    const ok = await this.siws.verifySignature(params);
    if (!ok) throw new UnauthorizedException('Invalid signature');

    const user = await this.upsertUser(params.walletAddress);
    // Banned users must not mint tokens/sessions (#37) — a valid signature only
    // proves key ownership, not standing.
    if (user.banned) throw new ForbiddenException('Account banned');
    const { accessToken, refreshToken } = await this.issueSession(
      user.id,
      user.walletAddress,
      ctx,
    );

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
  private async upsertUser(walletAddress: string) {
    const existing = await this.prisma.user.findUnique({ where: { walletAddress } });
    if (existing) return existing;

    // Multi-wallet: a non-primary linked address resolves to its owner.
    const linked = await this.prisma.linkedWallet.findUnique({
      where: { address: walletAddress },
      include: { user: true },
    });
    if (linked) return linked.user;

    try {
      return await this.prisma.user.create({
        data: {
          walletAddress,
          refCode: this.generateRefCode(),
        },
      });
    } catch {
      // Unique violation race — re-read and return the winner
      const retry = await this.prisma.user.findUnique({ where: { walletAddress } });
      if (retry) return retry;
      throw new Error('Failed to provision user');
    }
  }

  private generateRefCode(): string {
    // 8-char alphanumeric — collision probability negligible at platform
    // size; we still have a unique index enforcing it at the DB level.
    return randomBytes(6).toString('base64url').slice(0, 8).toUpperCase();
  }
}
