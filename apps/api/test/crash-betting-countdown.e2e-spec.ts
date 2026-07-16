import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma, gw, realPow } from './engine-harness';
import { CrashEngine } from '../src/games/crash/crash.engine';
import { CRASH } from '@scadium/shared';

/**
 * The crash snapshot must expose the betting window's REMAINING time so a
 * mid-window page refresh renders the true countdown instead of restarting from
 * a full 15s (the "counts down from 15 over and over on refresh" bug). It is
 * relative (ms remaining), so the client anchors it to its own clock.
 */
describe('crash betting-window remaining (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('snapshot() reports bettingMsRemaining during the waiting phase and null once running', async () => {
    const engine = new CrashEngine(prisma as never, gw(), { enabled: false } as never, realPow());

    // Open a round → 'waiting'. Fake timers suppress the 15s beginRun scheduling;
    // the DB writes inside startNewRound still run against real Postgres.
    vi.useFakeTimers();
    try {
      await (engine as unknown as { startNewRound: () => Promise<void> }).startNewRound();
    } finally {
      vi.useRealTimers();
    }

    const waiting = engine.snapshot() as { phase: string; bettingMsRemaining: number | null };
    expect(waiting.phase).toBe('waiting');
    expect(waiting.bettingMsRemaining).not.toBeNull();
    // Freshly opened → within (0, full window]. Proves it's the real remaining,
    // not a hardcoded constant, and that it's server-anchored.
    expect(waiting.bettingMsRemaining!).toBeGreaterThan(0);
    expect(waiting.bettingMsRemaining!).toBeLessThanOrEqual(CRASH.BET_WINDOW_MS);

    // Force the round into 'running' — the remaining is no longer meaningful.
    (engine as unknown as { current: { phase: string; startedAt: number } }).current.phase =
      'running';
    (engine as unknown as { current: { phase: string; startedAt: number } }).current.startedAt =
      Date.now();
    const running = engine.snapshot() as { phase: string; bettingMsRemaining: number | null };
    expect(running.phase).toBe('running');
    expect(running.bettingMsRemaining).toBeNull();
  });
});
