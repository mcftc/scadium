import { describe, it, expect } from 'vitest';
import { crashPoint, generateServerSeed, generateClientSeed, commitServerSeed } from '@scadium/fair';
import { prisma, makeUser, makeCrashEngine } from './engine-harness';

/**
 * Issue #93 / ADR 0001 — a shared-round bet must be independently verifiable from
 * its own `resultJson.fair` block: the revealed house seed pair reproduces the
 * shared outcome (here the crash bust) and the commitment matches the seed.
 */
describe('crash bet resultJson.fair self-verifies the shared bust (issue #93)', () => {
  it('the folded fair block reproduces the bust point and matches the commitment', async () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const nonce = 0;
    const bustPoint = crashPoint(serverSeed, clientSeed, nonce); // the REAL shared bust

    const seed = await prisma.seed.create({
      data: { serverSeed, serverSeedHash: commitServerSeed(serverSeed), clientSeed, nonce },
    });
    const round = await prisma.crashRound.create({
      data: { seedId: seed.id, nonce, status: 'running' },
    });
    const winner = await makeUser(0n);

    const engine = makeCrashEngine();
    (engine as unknown as { current: unknown }).current = {
      id: round.id,
      seedId: seed.id,
      serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed,
      nonce,
      bustPoint,
      phase: 'busted',
      startedAt: Date.now(),
      bets: new Map([
        [
          winner.id,
          {
            userId: winner.id,
            username: null,
            walletAddress: 'w1',
            amountLamports: 1_000n,
            originalAmountLamports: 1_000n,
            payoutLamports: 1_900n,
            autoCashout: null,
            cashedOutAt: 1.9,
          },
        ],
      ]),
    };

    await (engine as unknown as { settleRound: () => Promise<unknown> }).settleRound();

    const bet = await prisma.bet.findFirstOrThrow({
      where: { userId: winner.id, gameType: 'crash' },
    });
    const fair = (bet.resultJson as { fair?: Record<string, unknown> }).fair;
    expect(fair).toBeTruthy();
    // Commitment holds, and the revealed seed pair reproduces the shared bust.
    expect(commitServerSeed(fair!.serverSeed as string)).toBe(fair!.serverSeedHash);
    expect(crashPoint(fair!.serverSeed as string, fair!.clientSeed as string, fair!.nonce as number)).toBe(
      bustPoint,
    );
  });
});
