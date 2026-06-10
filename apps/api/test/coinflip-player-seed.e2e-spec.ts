import { describe, it, expect } from 'vitest';
import { coinflipResult, commitServerSeed } from '@scadium/fair';
import { COINFLIP } from '@scadium/shared';
import { CoinflipService } from '../src/games/coinflip/coinflip.service';
import { SeedManagerService } from '../src/fairness/seed-manager.service';
import { prisma, gw, offChain, makeUser } from './engine-harness';

/**
 * Issue #92 — a coinflip resolves from the JOINER's player-controlled client seed
 * and a monotonic per-user nonce (no server-minted client seed, nonce ≠ 0). The
 * result must reproduce from the revealed per-flip server seed + those inputs, and
 * the published commitment must match the revealed seed.
 */
describe('coinflip player-controlled seed (issue #92)', () => {
  const seeds = new SeedManagerService(prisma as never);
  const svc = new CoinflipService(prisma as never, gw(), offChain, seeds);

  it("derives from the joiner's client seed + monotonic nonce and reproduces from the revealed seed", async () => {
    const creator = await makeUser(1_000_000_000n);
    const joiner = await makeUser(1_000_000_000n);
    const amount = BigInt(COINFLIP.MIN_BET_LAMPORTS);

    // Joiner picks their OWN client seed beforehand.
    await seeds.setClientSeed(joiner.id, 'my-custom-seed');

    const flip = await svc.create({ userId: creator.id, side: 'heads', amountLamports: amount });
    const resolved = await svc.join({ userId: joiner.id, gameId: flip.id });

    expect(resolved.status).toBe('completed');
    // The flip used the joiner's client seed (not a server-minted one).
    expect(resolved.clientSeed).toBe('my-custom-seed');
    // The nonce is the joiner's monotonic counter — never the old hardcoded 0.
    expect(resolved.nonce).toBeGreaterThan(0);

    const revealed = resolved.serverSeed;
    expect(revealed).toBeTruthy();
    // Commitment holds: sha256(revealed) == the pre-bet published hash.
    expect(commitServerSeed(revealed!)).toBe(resolved.serverSeedHash);
    // The browser verifier reproduces the exact result from the player inputs.
    expect(coinflipResult(revealed!, 'my-custom-seed', resolved.nonce!)).toBe(resolved.result);
  });

  it('the per-user nonce strictly increases across consecutive flips', async () => {
    const creator = await makeUser(1_000_000_000n);
    const joiner = await makeUser(1_000_000_000n);
    const amount = BigInt(COINFLIP.MIN_BET_LAMPORTS);

    const f1 = await svc.create({ userId: creator.id, side: 'heads', amountLamports: amount });
    const r1 = await svc.join({ userId: joiner.id, gameId: f1.id });
    const f2 = await svc.create({ userId: creator.id, side: 'tails', amountLamports: amount });
    const r2 = await svc.join({ userId: joiner.id, gameId: f2.id });

    expect(r2.nonce!).toBeGreaterThan(r1.nonce!);
  });
});
