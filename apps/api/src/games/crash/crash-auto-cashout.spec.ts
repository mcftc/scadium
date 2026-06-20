import { describe, it, expect, vi } from 'vitest';
import { CrashEngine } from './crash.engine';

/**
 * #218 — a failed auto-cashout in the tick loop was swallowed by an empty
 * `catch {}`, hiding a dropped durable CrashBet write. The loop was extracted to
 * `runAutoCashouts(m)` so the failure path is testable: a throwing `cashOut` must
 * be logged (not silently swallowed), and the loop must continue to the next bet.
 */
describe('crash runAutoCashouts — failed cashout is logged, not swallowed (#218)', () => {
  // Minimal engine — runAutoCashouts only touches this.current, this.cashOut and
  // this.logger, so the injected deps are never used.
  const makeEngine = () =>
    new CrashEngine({} as never, {} as never, {} as never, {} as never) as unknown as {
      current: { id: string; bets: Map<string, unknown> };
      cashOut: (userId: string) => Promise<unknown>;
      logger: { error: (m: string) => void };
      runAutoCashouts: (m: number) => Promise<void>;
    };

  const bet = (userId: string, autoCashout: number) => ({
    userId,
    amountLamports: 1_000n,
    cashedOutAt: null,
    autoCashout,
  });

  it('logs an error when an auto-cashout throws, and still processes the other bets', async () => {
    const engine = makeEngine();
    engine.current = {
      id: 'round-1',
      bets: new Map<string, unknown>([
        ['u-fail', bet('u-fail', 2)],
        ['u-ok', bet('u-ok', 2)],
      ]),
    };
    const errorSpy = vi.spyOn(engine.logger, 'error').mockImplementation(() => undefined);
    // First user's cashout throws; the loop must log it and continue to u-ok.
    engine.cashOut = vi.fn(async (userId: string) => {
      if (userId === 'u-fail') throw new Error('durable write failed');
      return undefined;
    });

    await engine.runAutoCashouts(5); // m=5 ≥ autoCashout 2 for both

    expect(engine.cashOut).toHaveBeenCalledTimes(2); // both attempted (loop continued)
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toContain('u-fail');
    expect(errorSpy.mock.calls[0]![0]).toContain('crash auto-cashout failed');
  });

  it('does not log when every auto-cashout succeeds', async () => {
    const engine = makeEngine();
    engine.current = {
      id: 'round-2',
      bets: new Map<string, unknown>([['u', bet('u', 2)]]),
    };
    const errorSpy = vi.spyOn(engine.logger, 'error').mockImplementation(() => undefined);
    engine.cashOut = vi.fn(async () => undefined);

    await engine.runAutoCashouts(5);

    expect(engine.cashOut).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
