import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAutoBet, type AutoBetConfig } from './use-auto-bet';
import type { InstantSettleResult } from '@/hooks/use-instant-game';

const tick = (ms = 40) => new Promise<void>((r) => setTimeout(r, ms));

const mkResult = (amountLamports: string, won: boolean): InstantSettleResult => ({
  betId: 'b',
  gameType: 'dice',
  amountLamports,
  // Win pays 2× (net +stake); loss pays 0 (net −stake).
  payoutLamports: won ? (BigInt(amountLamports) * 2n).toString() : '0',
  multiplier: won ? 2 : 0,
  won,
  balanceLamports: '0',
  result: {},
  fairness: { serverSeedHash: '', clientSeed: '', nonce: 0 },
});

/** A runBet mock that plays a fixed win/loss sequence and records the stakes. */
function seqRunBet(outcomes: boolean[]) {
  let i = 0;
  return vi.fn(async (amt: string) => mkResult(amt, outcomes[i++] ?? false));
}

const cfg = (over: Partial<AutoBetConfig> = {}): AutoBetConfig => ({
  numberOfBets: 0,
  onWin: { mode: 'reset', pct: 0 },
  onLoss: { mode: 'reset', pct: 0 },
  stopProfitLamports: null,
  stopLossLamports: null,
  ...over,
});

const mount = (runBet: ReturnType<typeof seqRunBet>, base = 1000n, max = 1_000_000) =>
  renderHook(() =>
    useAutoBet({ runBet, baseStakeLamports: () => base, minLamports: 100, maxLamports: max }),
  );

const stakes = (runBet: ReturnType<typeof seqRunBet>) => runBet.mock.calls.map((c) => c[0]);

describe('useAutoBet', () => {
  it('places exactly numberOfBets bets then stops', async () => {
    const runBet = seqRunBet([false, false, false, false, false]);
    const { result } = mount(runBet);
    await act(async () => {
      await result.current.start(cfg({ numberOfBets: 3 }));
    });
    expect(runBet).toHaveBeenCalledTimes(3);
    expect(result.current.running).toBe(false);
  });

  it('doubles the stake after each loss (martingale) via onLoss increase 100%', async () => {
    const runBet = seqRunBet([false, false, false, false]);
    const { result } = mount(runBet);
    await act(async () => {
      await result.current.start(cfg({ numberOfBets: 4, onLoss: { mode: 'increase', pct: 100 } }));
    });
    expect(stakes(runBet)).toEqual(['1000', '2000', '4000', '8000']);
  });

  it('resets the stake to base after a win', async () => {
    const runBet = seqRunBet([false, false, true, false]); // lose, lose, win, lose
    const { result } = mount(runBet);
    await act(async () => {
      await result.current.start(
        cfg({
          numberOfBets: 4,
          onLoss: { mode: 'increase', pct: 100 },
          onWin: { mode: 'reset', pct: 0 },
        }),
      );
    });
    // 1000 →loss 2000 →loss 4000 →WIN reset→ 1000
    expect(stakes(runBet)).toEqual(['1000', '2000', '4000', '1000']);
  });

  it('clamps the progressed stake to the game max', async () => {
    const runBet = seqRunBet([false, false, false, false]);
    const { result } = mount(runBet, 1000n, 3000); // max 3000
    await act(async () => {
      await result.current.start(cfg({ numberOfBets: 4, onLoss: { mode: 'increase', pct: 100 } }));
    });
    expect(stakes(runBet)).toEqual(['1000', '2000', '3000', '3000']); // clamped at 3000
  });

  it('stops once cumulative profit reaches stopOnProfit', async () => {
    const runBet = seqRunBet([true, true, true, true]); // each win nets +stake (+1000)
    const { result } = mount(runBet);
    await act(async () => {
      await result.current.start(cfg({ stopProfitLamports: 1500n })); // infinite bets, stop on +1500
    });
    // +1000 after bet 1 (<1500, continue), +2000 after bet 2 (≥1500, stop).
    expect(runBet).toHaveBeenCalledTimes(2);
  });

  it('stops once cumulative loss reaches stopOnLoss', async () => {
    const runBet = seqRunBet([false, false, false, false]);
    const { result } = mount(runBet);
    await act(async () => {
      await result.current.start(cfg({ stopLossLamports: 1500n }));
    });
    // −1000 after bet 1 (<1500), −2000 after bet 2 (≥1500, stop).
    expect(runBet).toHaveBeenCalledTimes(2);
  });

  it('keeps ≤1 bet in flight and never resurrects a stopped loop across stop→restart', async () => {
    // Deferred runBet so we can park the loop mid-bet and control concurrency.
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<(r: InstantSettleResult) => void> = [];
    const runBet = vi.fn((amt: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<InstantSettleResult>((resolve) => {
        resolvers.push((r) => {
          inFlight -= 1;
          resolve(r);
        });
      });
    });
    const { result } = renderHook(() =>
      useAutoBet({ runBet, baseStakeLamports: () => 1000n, minLamports: 100, maxLamports: 1e9 }),
    );

    // Loop A places bet 1 and parks (unresolved).
    act(() => void result.current.start(cfg({ numberOfBets: 100 })));
    await waitFor(() => expect(runBet).toHaveBeenCalledTimes(1));

    // Stop, then restart (loop B) while bet 1 is still in flight.
    act(() => result.current.stop());
    act(() => void result.current.start(cfg({ numberOfBets: 100 })));

    // B must NOT place a bet yet — it drains A's in-flight bet first (≤1 in flight).
    await tick();
    expect(runBet).toHaveBeenCalledTimes(1);

    // Resolve bet 1 (A's). A is superseded → places no bet 2; B then proceeds.
    act(() => resolvers[0]!(mkResult('1000', false)));
    await waitFor(() => expect(runBet).toHaveBeenCalledTimes(2));
    expect(maxInFlight).toBe(1); // never two bets at once

    // Stop and drain — the dead loop A must never resurrect (total capped at 2).
    act(() => result.current.stop());
    act(() => resolvers[1]?.(mkResult('1000', false)));
    await tick();
    expect(runBet.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('a second start while a loop is live is a no-op (no second loop)', async () => {
    const resolvers: Array<() => void> = [];
    const runBet = vi.fn(
      (amt: string) =>
        new Promise<InstantSettleResult>((resolve) => {
          resolvers.push(() => resolve(mkResult(amt, false)));
        }),
    );
    const { result } = renderHook(() =>
      useAutoBet({ runBet, baseStakeLamports: () => 1000n, minLamports: 100, maxLamports: 1e9 }),
    );

    act(() => void result.current.start(cfg({ numberOfBets: 100 })));
    await waitFor(() => expect(runBet).toHaveBeenCalledTimes(1));
    // Second start while the first bet is in flight — must not launch a 2nd loop.
    act(() => void result.current.start(cfg({ numberOfBets: 100 })));
    await tick();
    expect(runBet).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.stop();
      resolvers[0]?.();
    });
  });

  it('stops the loop and reports when a bet throws', async () => {
    const onError = vi.fn();
    const runBet = vi.fn(async (amt: string) => {
      if (runBet.mock.calls.length >= 2) throw new Error('insufficient balance');
      return mkResult(amt, false);
    });
    const { result } = renderHook(() =>
      useAutoBet({ runBet, baseStakeLamports: () => 1000n, minLamports: 100, maxLamports: 1e9, onError }),
    );
    await act(async () => {
      await result.current.start(cfg({ numberOfBets: 10 }));
    });
    expect(runBet).toHaveBeenCalledTimes(2); // 1 ok, 2nd throws → stop
    expect(onError).toHaveBeenCalledWith('insufficient balance');
    expect(result.current.running).toBe(false);
  });
});
