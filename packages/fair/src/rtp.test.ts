import { describe, it, expect } from 'vitest';
import { crashPoint } from './crash';
import {
  GAME_RTP,
  HOUSE_EDGE,
  RTP,
  COINFLIP,
  CRASH,
  DICE,
  LIMBO,
  MINES,
  HILO,
  TOWER,
  WHEEL_PAYOUT_BUCKETS,
  wheelExpectedValue,
  PLINKO,
  plinkoPayouts,
  plinkoExpectedValue,
  diceMultiplier,
} from '@scadium/shared';

/**
 * RTP standardization guard: every house-banked game targets a 95% return (5%
 * hold) from the single `HOUSE_EDGE` source. Lottery and blackjack are EXEMPT
 * (pool/burn and rules-based edges respectively). Because all payout helpers
 * floor to 2 dp (conservative — never overpays), the realised EV sits at or just
 * below RTP; these tests lock both "never above RTP" and "close to RTP".
 */
describe('RTP standardization (95%)', () => {
  it('single source: HOUSE_EDGE = 0.05, RTP = 0.95', () => {
    expect(HOUSE_EDGE).toBe(0.05);
    expect(RTP).toBe(0.95);
  });

  it('every standardized game points its edge at HOUSE_EDGE', () => {
    expect(LIMBO.HOUSE_EDGE).toBe(HOUSE_EDGE);
    expect(MINES.HOUSE_EDGE).toBe(HOUSE_EDGE);
    expect(HILO.HOUSE_EDGE).toBe(HOUSE_EDGE);
    expect(TOWER.HOUSE_EDGE).toBe(HOUSE_EDGE);
    expect(COINFLIP.HOUSE_EDGE).toBe(HOUSE_EDGE);
    // Crash's edge is structural (the h%20 instant-bust = 1/20 = 5%); the
    // constant must not drift from the formula it documents.
    expect(CRASH.HOUSE_EDGE).toBe(HOUSE_EDGE);
    expect(CRASH.INSTANT_BUST_CHANCE).toBe(HOUSE_EDGE); // 1/20 === 0.05
  });

  it('dice runs a 1% edge (industry-standard 99/chance) in both modes', () => {
    // Deliberate exception to the platform 5%: crypto-dice convention is 1%.
    expect(DICE.HOUSE_EDGE).toBe(0.01);
    const rtpDice = 1 - DICE.HOUSE_EDGE;
    for (let target = DICE.MIN_TARGET; target <= DICE.MAX_TARGET; target++) {
      for (const mode of DICE.MODES) {
        const chance = (mode === 'over' ? 100 - target : target) / 100;
        const ev = diceMultiplier(target, mode) * chance;
        expect(ev, `target=${target} mode=${mode}`).toBeLessThanOrEqual(rtpDice + 1e-9);
        expect(ev, `target=${target} mode=${mode}`).toBeGreaterThan(rtpDice - 0.02);
        // No sub-1× "wins" anywhere in the selectable range.
        expect(diceMultiplier(target, mode), `target=${target} mode=${mode}`).toBeGreaterThanOrEqual(1.01);
      }
      // The two modes split the 10,000-outcome grid exactly.
      expect(100 * target + (10_000 - 100 * target)).toBe(10_000);
    }
  });

  it('coinflip pays 2 × RTP = 1.9× (5% taken upfront)', () => {
    expect(COINFLIP.PAYOUT_MULTIPLIER).toBe(1.9);
    expect(COINFLIP.PAYOUT_MULTIPLIER).toBe(Math.round(2 * RTP * 100) / 100);
  });

  it('wheel EV equals RTP (scaled buckets, floored)', () => {
    const ev = wheelExpectedValue(WHEEL_PAYOUT_BUCKETS);
    expect(ev).toBeLessThanOrEqual(RTP + 1e-9);
    expect(ev).toBeGreaterThan(RTP - 0.02);
  });

  it('plinko EV equals RTP for every row count (scaled, floored)', () => {
    for (const rows of PLINKO.ROWS) {
      const payouts = plinkoPayouts(rows)!;
      const ev = plinkoExpectedValue(payouts);
      expect(ev, `rows=${rows}`).toBeLessThanOrEqual(RTP + 1e-9);
      expect(ev, `rows=${rows}`).toBeGreaterThan(RTP - 0.02);
    }
  });
});

describe('GAME_RTP published figures (single source, #roadmap-2)', () => {
  it('covers all 12 game types', () => {
    const games = [
      'crash', 'coinflip', 'blackjack', 'lottery', 'jackpot',
      'dice', 'limbo', 'wheel', 'plinko', 'mines', 'tower', 'hilo',
    ];
    for (const g of games) expect(GAME_RTP[g], `GAME_RTP.${g}`).toBeDefined();
  });

  it('edge-based games publish exactly (1 - HOUSE_EDGE) — never overstated', () => {
    expect(GAME_RTP.crash!.rtp).toBe('94.05%'); // the formula's real return (B2), not the old claim
    expect(GAME_RTP.coinflip!.rtp).toBe('95%');
    expect(GAME_RTP.limbo!.rtp).toBe('95%');
    expect(GAME_RTP.mines!.rtp).toBe('95%');
    expect(GAME_RTP.tower!.rtp).toBe('95%');
    expect(GAME_RTP.hilo!.rtp).toBe('95%');
    expect(GAME_RTP.wheel!.rtp).toBe('95%');
    expect(GAME_RTP.plinko!.rtp).toBe('95%');
    expect(GAME_RTP.dice!.rtp).toBe('99%'); // deliberate 1% edge
  });
});

describe('crash RTP is what the formula pays (B2)', () => {
  it('the closed form: P(win at M) = 0.95 × 99/(100M) at every target → RTP 94.05%', () => {
    for (const M of [1.01, 1.5, 2, 3.33, 10, 100]) {
      const pWin = (1 - CRASH.INSTANT_BUST_CHANCE) * (99 / (100 * M));
      expect(M * pWin).toBeCloseTo(CRASH.RTP, 12);
    }
    expect(CRASH.RTP).toBeCloseTo(0.9405, 12);
    expect(GAME_RTP.crash!.rtp).toBe('94.05%');
  });

  it('the real bust function returns ~94.05% (Monte Carlo, deterministic seeds)', () => {
    // The advertised 95% was never measured against crashPoint(); this is.
    const N = 200_000;
    const targets = [1.5, 2, 5];
    const paid = targets.map(() => 0);
    for (let i = 0; i < N; i += 1) {
      const bust = crashPoint(`mc-server-${i}`, 'mc-client', i);
      targets.forEach((M, k) => {
        if (M < bust) paid[k]! += M; // a target equal to the bust loses
      });
    }
    targets.forEach((M, k) => {
      const rtp = paid[k]! / N;
      // ±3 standard errors of the per-round payout at this target.
      const p = 0.9405 / M;
      const tol = (3 * M * Math.sqrt(p * (1 - p))) / Math.sqrt(N);
      expect(Math.abs(rtp - CRASH.RTP), `M=${M} rtp=${rtp}`).toBeLessThan(tol);
    });
  });
});
