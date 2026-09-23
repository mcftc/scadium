import { describe, it, expect, vi } from 'vitest';
import { HOUSE } from '@scadium/shared';
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
      current: { id: string; bustPoint: number; bets: Map<string, unknown> };
      cashOut: (userId: string) => Promise<unknown>;
      logger: { error: (m: string) => void };
      runAutoCashouts: (m: number) => Promise<void>;
    };

  const bet = (userId: string, autoCashout: number) => ({
    userId,
    amountLamports: 1_000n,
    originalAmountLamports: 1_000n,
    payoutLamports: 0n,
    cashedOutAt: null,
    autoCashout,
  });

  it('logs an error when an auto-cashout throws, and still processes the other bets', async () => {
    const engine = makeEngine();
    engine.current = {
      id: 'round-1',
      bustPoint: 10, // targets (2) < bust → winning auto-cashouts fire
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
      bustPoint: 10,
      bets: new Map<string, unknown>([['u', bet('u', 2)]]),
    };
    const errorSpy = vi.spyOn(engine.logger, 'error').mockImplementation(() => undefined);
    engine.cashOut = vi.fn(async () => undefined);

    await engine.runAutoCashouts(5);

    expect(engine.cashOut).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

/**
 * B2 — payouts ignored HOUSE.MAX_WIN_PER_BET: a 100 SOL bet cashed at 1,000×
 * paid 100,000 SOL while the round reserved 50. The cap is on NET win (stake +
 * cap is the most one bet can take back), enforced two ways: a riding position
 * is exited automatically where it reaches the cap, and any cash-out is clamped.
 */
describe('crash net-win cap (B2)', () => {
  const SOL = 1_000_000_000n;
  const CAP = BigInt(HOUSE.MAX_WIN_PER_BET_LAMPORTS);

  const running = (bets: Map<string, unknown>) => ({
    id: 'r',
    phase: 'running',
    startedAt: Date.now(),
    bustPoint: 1_000_000,
    bets,
  });
  const riding = (userId: string, stake: bigint, autoCashout: number | null) => ({
    userId,
    username: null,
    walletAddress: 'w',
    playerId: 'p',
    player: 'p',
    amountLamports: stake,
    originalAmountLamports: stake,
    payoutLamports: 0n,
    autoCashout,
    cashedOutAt: null,
  });

  it('exits a riding position at the multiplier where it reaches the cap', async () => {
    const engine = new CrashEngine({} as never, {} as never, {} as never, {} as never) as unknown as {
      current: unknown;
      cashOut: (userId: string, pct: number, at?: number) => Promise<unknown>;
      runAutoCashouts: (m: number) => Promise<void>;
    };
    const stake = 60n * SOL; // no auto-cashout set
    engine.current = running(new Map([['u', riding('u', stake, null)]]));
    engine.cashOut = vi.fn(async () => undefined);

    await engine.runAutoCashouts(1.5); // below the cap multiplier — nothing yet
    expect(engine.cashOut).not.toHaveBeenCalled();

    await engine.runAutoCashouts(5);
    const capM = Math.floor(Number(((stake + CAP) * 100n) / stake)) / 100; // (60+50)/60 → 1.83
    expect(engine.cashOut).toHaveBeenCalledWith('u', 100, capM);
  });

  it('clamps any cash-out so the bet never takes back more than stake + cap', async () => {
    const update = vi.fn(async () => ({}));
    const engine = new CrashEngine(
      { crashBet: { update } } as never,
      { emitCashedOut: () => undefined } as never,
      {} as never,
      {} as never,
    ) as unknown as {
      current: unknown;
      cashOut: (
        userId: string,
        pct: number,
        at?: number,
      ) => Promise<{ payoutLamports: bigint }>;
    };
    const stake = 10n * SOL;
    engine.current = running(new Map([['u', riding('u', stake, 1_000)]]));

    const res = await engine.cashOut('u', 100, 1_000); // 10 SOL × 1000× = 10,000 SOL uncapped
    expect(res.payoutLamports).toBe(stake + CAP);
  });
});
