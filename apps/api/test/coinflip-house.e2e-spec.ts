import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { COINFLIP } from '@scadium/shared';
import { coinflipResult } from '@scadium/fair';
import { CoinflipService } from '../src/games/coinflip/coinflip.service';
import { SeedManagerService } from '../src/fairness/seed-manager.service';
import { RgService } from '../src/responsible-gambling/rg.service';
import { prisma, makeUser } from './engine-harness';

/**
 * Coinflip on a quiet site (four-games hardening C1) and its B5 fixes, against
 * real Postgres: playing the house, open-flip expiry, the per-user cap, a
 * self-exclusion cancelling open flips, and nothing broadcast before commit.
 */

const STAKE = 10_000_000n; // 0.01 SOL
const PAYOUT = (STAKE * BigInt(Math.round(COINFLIP.PAYOUT_MULTIPLIER * 100))) / 100n;

function makeService(overrides: { accrue?: () => Promise<bigint> } = {}) {
  const gateway = { emitCreated: vi.fn(), emitResolved: vi.fn(), emitCancelled: vi.fn() };
  const svc = new CoinflipService(
    prisma as never,
    gateway as never,
    { enabled: false } as never,
    new SeedManagerService(prisma as never),
    { assertCanWager: async () => undefined } as never,
    { creditReferral: async () => undefined } as never,
    { accrue: overrides.accrue ?? (async () => 0n) } as never,
  );
  return { svc, gateway };
}

const balance = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).playBalanceLamports;

describe('coinflip vs the house, expiry and limits (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a vs-house flip resolves at once from the creator’s own seed, at 1.9×', async () => {
    const { svc, gateway } = makeService();
    const u = await makeUser(STAKE);
    const flip = await svc.create({ userId: u.id, side: 'heads', amountLamports: STAKE, vsHouse: true });

    expect(flip.status).toBe('completed');
    expect(flip.vsHouse).toBe(true);
    expect(flip.joinerId).toBeNull();
    // The result reproduces from the revealed flip seed + the CREATOR's client
    // seed and nonce — the operator never picked which flips the house took.
    expect(flip.serverSeed).not.toBeNull();
    expect(coinflipResult(flip.serverSeed!, flip.clientSeed!, flip.nonce!)).toBe(flip.result);
    const creatorWon = flip.result === 'heads';
    expect(flip.winnerId).toBe(creatorWon ? u.id : null);
    expect(await balance(u.id)).toBe(creatorWon ? PAYOUT : 0n);
    expect(await prisma.bet.count({ where: { userId: u.id, gameType: 'coinflip' } })).toBe(1);
    expect(gateway.emitResolved).toHaveBeenCalledTimes(1);
    expect(gateway.emitCreated).not.toHaveBeenCalled();
  });

  it('only the creator can send their open flip to the house', async () => {
    const { svc } = makeService();
    const creator = await makeUser(STAKE);
    const stranger = await makeUser(STAKE);
    const open = await svc.create({ userId: creator.id, side: 'tails', amountLamports: STAKE });
    expect(open.status).toBe('open');

    await expect(svc.playHouse({ userId: stranger.id, gameId: open.id })).rejects.toThrow(/creator/);
    const played = await svc.playHouse({ userId: creator.id, gameId: open.id });
    expect(played.status).toBe('completed');
    expect(played.vsHouse).toBe(true);
    // Resolved once — a second call finds nothing open.
    await expect(svc.playHouse({ userId: creator.id, gameId: open.id })).rejects.toThrow(
      /not joinable/,
    );
  });

  it('an unjoined flip expires: cancelled, refunded, and no longer joinable', async () => {
    const { svc, gateway } = makeService();
    const creator = await makeUser(STAKE);
    const joiner = await makeUser(STAKE);
    const open = await svc.create({ userId: creator.id, side: 'heads', amountLamports: STAKE });
    expect(await balance(creator.id)).toBe(0n);
    await prisma.coinflipGame.update({
      where: { id: open.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    // Past its TTL it is not joinable even before the sweep runs…
    await expect(svc.join({ userId: joiner.id, gameId: open.id })).rejects.toThrow(/not joinable/);
    // …and the sweep cancels + refunds it through the same CAS as a manual cancel.
    expect(await svc.expireStale()).toBeGreaterThanOrEqual(1);
    expect((await prisma.coinflipGame.findUniqueOrThrow({ where: { id: open.id } })).status).toBe(
      'cancelled',
    );
    expect(await balance(creator.id)).toBe(STAKE);
    expect(await balance(joiner.id)).toBe(STAKE); // the rejected join took nothing
    expect(gateway.emitCancelled).toHaveBeenCalledWith({ id: open.id });
  });

  it('caps open flips per player', async () => {
    const { svc } = makeService();
    const u = await makeUser(STAKE * BigInt(COINFLIP.MAX_OPEN_PER_USER + 1));
    for (let i = 0; i < COINFLIP.MAX_OPEN_PER_USER; i += 1) {
      await svc.create({ userId: u.id, side: 'heads', amountLamports: STAKE });
    }
    await expect(svc.create({ userId: u.id, side: 'heads', amountLamports: STAKE })).rejects.toThrow(
      /open flips/,
    );
    // …but the house is always available.
    const house = await svc.create({ userId: u.id, side: 'heads', amountLamports: STAKE, vsHouse: true });
    expect(house.status).toBe('completed');
  });

  it('self-exclusion cancels and refunds the player’s open flips (B5)', async () => {
    const { svc } = makeService();
    const rg = new RgService(
      prisma as never,
      { isPaused: async () => false } as never,
      { realMoneyEnabled: false } as never,
    );
    const u = await makeUser(STAKE * 2n);
    const a = await svc.create({ userId: u.id, side: 'heads', amountLamports: STAKE });
    const b = await svc.create({ userId: u.id, side: 'tails', amountLamports: STAKE });
    expect(await balance(u.id)).toBe(0n);

    await rg.setSelfExclusion(u.id, new Date(Date.now() + 7 * 86_400_000));

    for (const id of [a.id, b.id]) {
      expect((await prisma.coinflipGame.findUniqueOrThrow({ where: { id } })).status).toBe(
        'cancelled',
      );
    }
    expect(await balance(u.id)).toBe(STAKE * 2n);
  });

  it('nothing is broadcast when the settle transaction fails (B5)', async () => {
    const { svc, gateway } = makeService({
      accrue: async () => {
        throw new Error('induced failure inside the settle tx');
      },
    });
    const u = await makeUser(STAKE);
    await expect(
      svc.create({ userId: u.id, side: 'heads', amountLamports: STAKE, vsHouse: true }),
    ).rejects.toThrow(/induced/);
    // The revealed seed used to go out on the socket before the commit; a
    // rolled-back flip must leave no trace — no event, no debit.
    expect(gateway.emitResolved).not.toHaveBeenCalled();
    expect(gateway.emitCreated).not.toHaveBeenCalled();
    expect(await balance(u.id)).toBe(STAKE);
  });
});
