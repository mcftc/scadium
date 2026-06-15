import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, gw } from './engine-harness';
import { AirdropEngine } from '../src/airdrop/airdrop.engine';

const engine = new AirdropEngine(prisma as never, gw(), {
  assertCanWager: async () => undefined,
} as never);

// filterEligibleForSybil is private — exercise it directly.
const filter = (ids: string[]) =>
  (engine as unknown as { filterEligibleForSybil(c: string[]): Promise<string[]> }).filterEligibleForSybil(
    ids,
  );

const mkUser = (over: Record<string, unknown>) =>
  prisma.user.create({
    data: { walletAddress: `sybil-${randomUUID()}`, refCode: `sybil-${randomUUID().slice(0, 12)}`, ...over },
  });

describe('airdrop sybil eligibility (#47, integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('drops non-age-confirmed wallets and same-IP clusters; keeps an age-confirmed unique-IP wallet', async () => {
    const now = new Date();
    // Two wallets sharing an IP, neither age-confirmed → both excluded.
    const s1 = await mkUser({ signupIpHash: 'farm-ip', ageConfirmedAt: null });
    const s2 = await mkUser({ signupIpHash: 'farm-ip', ageConfirmedAt: null });
    // Age-confirmed, unique IP → qualifies.
    const ok = await mkUser({ signupIpHash: `uniq-${randomUUID()}`, ageConfirmedAt: now });
    // Age-confirmed but a same-IP cluster → both excluded.
    const c1 = await mkUser({ signupIpHash: 'cluster-ip', ageConfirmedAt: now });
    const c2 = await mkUser({ signupIpHash: 'cluster-ip', ageConfirmedAt: now });

    const eligible = await filter([s1.id, s2.id, ok.id, c1.id, c2.id]);
    expect(eligible).toContain(ok.id);
    expect(eligible).not.toContain(s1.id);
    expect(eligible).not.toContain(s2.id);
    expect(eligible).not.toContain(c1.id);
    expect(eligible).not.toContain(c2.id);
  });
});
