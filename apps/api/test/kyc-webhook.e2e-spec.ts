import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { prisma } from './engine-harness';
import { KycService } from '../src/kyc/kyc.service';

const SECRET = 'test-kyc-secret';
const cfg = {
  get: (k: string) => (k === 'KYC_WEBHOOK_SECRET' ? SECRET : k === 'KYC_ENABLED' ? 'true' : undefined),
} as unknown as ConfigService;
const kyc = new KycService(prisma as never, cfg);
const sign = (ref: string, status: string) =>
  createHmac('sha256', SECRET).update(`${ref}:${status}`).digest('hex');

const mkPending = (ref: string) =>
  prisma.user.create({
    data: {
      walletAddress: `kyc-${randomUUID()}`,
      refCode: `kyc-${randomUUID().slice(0, 10)}`,
      kycStatus: 'pending',
      kycProviderRef: ref,
    },
  });

describe('kyc webhook (#45, integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('applies a signature-valid approved webhook → approved + sanctions-cleared + reviewed', async () => {
    const ref = `kyc-${randomUUID()}`;
    const u = await mkPending(ref);
    expect(kyc.verifySignature(ref, 'approved', sign(ref, 'approved'))).toBe(true);

    await kyc.applyWebhook({ providerRef: ref, status: 'approved', sanctionsCleared: true });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.kycStatus).toBe('approved');
    expect(after.sanctionsCleared).toBe(true);
    expect(after.kycReviewedAt).not.toBeNull();
  });

  it('rejects an invalid signature (verifySignature false)', async () => {
    const ref = `kyc-${randomUUID()}`;
    expect(kyc.verifySignature(ref, 'approved', 'deadbeef')).toBe(false);
    expect(kyc.verifySignature(ref, 'approved', undefined)).toBe(false);
  });

  it('does not sanctions-clear when the provider verdict is not approved', async () => {
    const ref = `kyc-${randomUUID()}`;
    const u = await mkPending(ref);
    await kyc.applyWebhook({ providerRef: ref, status: 'rejected', sanctionsCleared: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.kycStatus).toBe('rejected');
    expect(after.sanctionsCleared).toBe(false);
  });
});
