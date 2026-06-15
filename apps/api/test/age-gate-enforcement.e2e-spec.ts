import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { prisma, makeUser } from './engine-harness';
import { RgService } from '../src/responsible-gambling/rg.service';

/**
 * Server-side age-gate enforcement (#146, integration, real Postgres).
 * Every game/bet entry routes through RgService.assertCanWager (and deposits
 * through assertCanDeposit), so enforcing the 18+ acknowledgement there gates
 * all play at the API — not just the client modal (#44). Enforced only when
 * real money is enabled; the play-money demo treats the gate as a UX ack.
 */
describe('age-gate enforcement (#146)', () => {
  const noPause = { isPaused: async () => false } as never;
  const realMoneyOn = new RgService(prisma as never, noPause, { realMoneyEnabled: true } as never);
  const realMoneyOff = new RgService(prisma as never, noPause, {
    realMoneyEnabled: false,
  } as never);

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('blocks an un-acked user from wagering when real money is enabled', async () => {
    const u = await makeUser(1_000_000_000n); // makeUser leaves ageConfirmedAt null
    await expect(realMoneyOn.assertCanWager(u.id, 100_000_000n)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(realMoneyOn.assertCanWager(u.id, 100_000_000n)).rejects.toThrow(
      /age verification/i,
    );
  });

  it('blocks an un-acked user from depositing when real money is enabled', async () => {
    const u = await makeUser(0n);
    await expect(realMoneyOn.assertCanDeposit(u.id, 100_000_000n)).rejects.toThrow(
      /age verification/i,
    );
  });

  it('allows wagering once the user has acknowledged 18+ (ageConfirmedAt set)', async () => {
    const u = await makeUser(1_000_000_000n);
    await prisma.user.update({ where: { id: u.id }, data: { ageConfirmedAt: new Date() } });
    await expect(realMoneyOn.assertCanWager(u.id, 100_000_000n)).resolves.toBeUndefined();
  });

  it('does NOT gate an un-acked user in the play-money demo (real money off)', async () => {
    const u = await makeUser(1_000_000_000n);
    await expect(realMoneyOff.assertCanWager(u.id, 100_000_000n)).resolves.toBeUndefined();
  });
});
