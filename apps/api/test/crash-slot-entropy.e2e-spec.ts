import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { crashPointFromSlot, syntheticSlotHash } from '@scadium/fair';
import { CrashEngine } from '../src/games/crash/crash.engine';
import { prisma, gw } from './engine-harness';

/**
 * Issue #101 / ADR 0002 — with CRASH_ONCHAIN_ENTROPY on, the bust is NOT known at
 * round open (entropy_requested + a pinned targetSlot); it's derived at run-time
 * from the slot's hash and persisted (entropy_fulfilled). Chain-disabled here, so
 * the documented synthetic fallback drives it deterministically (no stranded bets).
 */
const chainStub = {
  enabled: false,
  currentSlot: async () => null,
  readSlotHash: async () => null,
} as never;

type Eng = {
  current: { id: string; serverSeed: string; clientSeed: string; bustPoint: number };
  startNewRound: () => Promise<void>;
  fulfillEntropy: () => Promise<void>;
};

describe('crash on-chain SlotHashes entropy flow (issue #101)', () => {
  beforeAll(() => {
    process.env.CRASH_ONCHAIN_ENTROPY = 'true';
  });
  afterAll(() => {
    delete process.env.CRASH_ONCHAIN_ENTROPY;
  });

  it('defers the bust at open, derives + persists it at run, idempotently', async () => {
    const engine = new CrashEngine(prisma as never, gw(), chainStub) as unknown as Eng;
    await engine.startNewRound();
    const cur = engine.current;

    // Deferred: the bust is unknown at commit; the round is entropy_requested with
    // a pinned target slot.
    expect(cur.bustPoint).toBe(0);
    const opened = await prisma.crashRound.findUniqueOrThrow({ where: { id: cur.id } });
    expect(opened.entropyStatus).toBe('entropy_requested');
    expect(opened.targetSlot).not.toBeNull();

    // Fulfill — chain disabled → deterministic synthetic slot hash fallback.
    await engine.fulfillEntropy();
    const synthetic = syntheticSlotHash(cur.serverSeed, cur.clientSeed);
    const expected = crashPointFromSlot(cur.serverSeed, cur.clientSeed, synthetic, 0);
    expect(cur.bustPoint).toBe(expected);

    const fulfilled = await prisma.crashRound.findUniqueOrThrow({ where: { id: cur.id } });
    expect(fulfilled.entropyStatus).toBe('entropy_fulfilled');
    expect(fulfilled.slotHash).toBe(synthetic.toString('hex'));

    // Idempotent: re-running yields the same deterministic bust.
    await engine.fulfillEntropy();
    expect(cur.bustPoint).toBe(expected);
  });
});
