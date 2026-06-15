import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export type KycStatusValue = 'none' | 'pending' | 'approved' | 'rejected';

/**
 * KYC / identity verification (#45). Gated behind `KYC_ENABLED` — off in the
 * play-money demo. We store only a provider reference + status, never raw
 * documents. The real Sumsub/Onfido applicant + SDK-token call is a flagged TODO
 * (stubbed token here); the webhook signature check and status state-machine are
 * real so the gate can be exercised end-to-end.
 */
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  get enabled(): boolean {
    return this.config.get<string>('KYC_ENABLED') === 'true';
  }

  /** Begin verification: stamp `pending` + a provider ref, return an SDK token. */
  async start(userId: string): Promise<{ token: string; providerRef: string; status: KycStatusValue }> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true, kycProviderRef: true },
    });
    // Never silently revoke an already-cleared user on a repeat click.
    if (existing?.kycStatus === 'approved') {
      throw new ConflictException('Identity already verified');
    }
    const providerRef = existing?.kycProviderRef ?? `kyc-${userId}`;
    // Idempotent while pending; only (re)stamp from a non-pending state.
    if (existing?.kycStatus !== 'pending') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { kycStatus: 'pending', kycProviderRef: providerRef },
      });
    }
    // TODO(#45-followup): create a real provider applicant + SDK token when a
    // provider key is configured. Stub token until then (gated by KYC_ENABLED).
    return { token: `kyc-stub-${providerRef}`, providerRef, status: 'pending' };
  }

  /** HMAC-SHA256 over `${providerRef}:${status}` keyed by KYC_WEBHOOK_SECRET. */
  verifySignature(providerRef: string, status: string, signature: string | undefined): boolean {
    const secret = this.config.get<string>('KYC_WEBHOOK_SECRET');
    if (!secret || !signature) return false;
    const expected = createHmac('sha256', secret).update(`${providerRef}:${status}`).digest('hex');
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(signature, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /** Apply a verified provider verdict to the user identified by providerRef. */
  async applyWebhook(input: {
    providerRef: string;
    status: string;
    sanctionsCleared?: boolean;
  }): Promise<void> {
    const status = this.mapStatus(input.status);
    // State-machine guard (#45): only act on a PENDING verification. A replayed
    // signature can't re-approve an already-approved/rejected user (they're not
    // pending) — a fresh review must go through `start()` → pending again.
    await this.prisma.user.updateMany({
      where: { kycProviderRef: input.providerRef, kycStatus: 'pending' },
      data: {
        kycStatus: status,
        sanctionsCleared: status === 'approved' ? (input.sanctionsCleared ?? false) : false,
        kycReviewedAt: new Date(),
      },
    });
  }

  /** True only when the user is fully cleared to move real money. */
  async isCleared(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true, sanctionsCleared: true },
    });
    return u?.kycStatus === 'approved' && u.sanctionsCleared === true;
  }

  private mapStatus(provider: string): KycStatusValue {
    if (provider === 'approved') return 'approved';
    if (provider === 'rejected') return 'rejected';
    return 'pending';
  }
}
