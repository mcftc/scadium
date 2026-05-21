import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SiwsService } from './siws.service';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'node:crypto';

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
  ) {}

  requestNonce(walletAddress: string) {
    return this.siws.issueNonce(walletAddress);
  }

  async verifyAndIssueToken(params: {
    walletAddress: string;
    nonce: string;
    signature: string;
    message: string;
  }) {
    const ok = this.siws.verifySignature(params);
    if (!ok) throw new UnauthorizedException('Invalid signature');

    const user = await this.upsertUser(params.walletAddress);

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      userId: user.id,
      walletAddress: user.walletAddress,
      typ: 'access',
    });

    return {
      accessToken,
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

  /**
   * Find the user by wallet address or create a fresh row. Handles the race
   * where two concurrent first-sign-ins for the same wallet both try to
   * insert by catching the unique-constraint violation and re-reading.
   */
  private async upsertUser(walletAddress: string) {
    const existing = await this.prisma.user.findUnique({ where: { walletAddress } });
    if (existing) return existing;

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
