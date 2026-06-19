import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HOUSE, LAMPORTS_PER_SOL } from '@scadium/shared';
import { CrashEngine } from '../src/games/crash/crash.engine';
import { BlackjackEngine } from '../src/games/blackjack/blackjack.engine';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { ExposureGuard } from '../src/common/exposure-guard';
import { lowBankrollAlertsTotal } from '../src/observability/metrics.registry';
import { prisma, gw, pow } from './engine-harness';

/**
 * #30 bankroll-drain: with a NEAR-FLOOR house vault, a large-multiplier win
 * cannot over-expose the bankroll — the exposure cap rejects it at bet
 * acceptance (the on-chain rent floor in `settle_bet` is the hard stop,
 * covered by tests/scadium_vault.ts) — and the solvency monitor raises a
 * low-bankroll alert. Chain reads are stubbed at the ChainService seam, same
 * as vault-bridge.e2e-spec.ts.
 */

/** Rent::minimum_balance(0) — mirrors reconciliation.service.ts. */
const RENT_FLOOR = 890_880n;
const SOL = BigInt(LAMPORTS_PER_SOL);

/** Funded chain stub: only what the engines/monitor read. */
const fundedChain = (houseBalance: bigint) =>
  ({
    enabled: true,
    houseVaultBalance: async () => houseBalance,
  }) as never;

describe('bankroll drain guard (#30, near-floor house vault)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // house_vault holding just rent floor + 0.5 SOL — far under the 1 SOL buffer.
  const NEAR_FLOOR = RENT_FLOOR + SOL / 2n;

  it('crash: a large-multiplier bet is rejected, the round stays bounded above the rent floor', () => {
    const engine = new CrashEngine(prisma as never, gw(), fundedChain(NEAR_FLOOR), pow());
    const exposure = new ExposureGuard(NEAR_FLOOR);
    (engine as unknown as { current: unknown }).current = {
      id: randomUUID(),
      phase: 'waiting',
      bets: new Map(),
      exposure,
    };

    // 0.001 SOL stake riding to 1,000,000× — potential is anchored to the
    // 50 SOL MAX_WIN, which dwarfs the ~0.1 SOL round cap of this vault.
    expect(() =>
      engine.placeBet({
        userId: randomUUID(),
        username: 'whale',
        walletAddress: 'w-whale',
        amountLamports: SOL / 1000n,
        autoCashout: null, // null = ride to MAX_CASHOUT_MULTIPLIER
      }),
    ).toThrow(/exposure limit/i);
    expect(exposure.reservedLamports).toBe(0n); // nothing held by the rejected bet

    // A modest bet (0.01 SOL → 2×) fits and is accepted.
    expect(
      engine.placeBet({
        userId: randomUUID(),
        username: 'minnow',
        walletAddress: 'w-minnow',
        amountLamports: SOL / 100n,
        autoCashout: 2,
      }).ok,
    ).toBe(true);

    // Even if EVERY accepted bet wins at its max, the payout fits above the
    // rent floor: reserved ≤ 20% cap < spendable (balance − floor).
    expect(exposure.reservedLamports).toBeLessThanOrEqual(exposure.roundCapLamports);
    expect(exposure.roundCapLamports).toBeLessThan(NEAR_FLOOR - RENT_FLOOR);
  });

  it('blackjack: an over-cap seat bet is rejected; clearing a bet releases its hold', () => {
    const engine = new BlackjackEngine(prisma as never, gw(), fundedChain(NEAR_FLOOR), pow());
    const exposure = new ExposureGuard(NEAR_FLOOR);
    const tableId = randomUUID();
    const userId = randomUUID();
    const seat = {
      index: 0,
      userId,
      username: 'p1',
      walletAddress: 'w-p1',
      idleRounds: 0,
      bet: null,
      cards: [],
      status: 'playing',
      doubled: false,
      side21p3Outcome: null,
      sidePerfectPairsOutcome: null,
      result: null,
      payoutLamports: 0n,
    };
    (engine as unknown as { tables: Map<string, unknown> }).tables.set(tableId, {
      id: tableId,
      name: 't',
      isPrivate: false,
      ownerId: null,
      maxSeats: 5,
      phase: 'betting',
      closeAt: Date.now() + 10_000,
      activeSeat: null,
      seats: new Map([[0, seat]]),
      dealerCards: [],
      dealerHidden: true,
      deckIndex: 0,
      dealLog: [],
      roundDbId: null,
      seedId: null,
      serverSeed: null,
      serverSeedHash: null,
      clientSeed: null,
      nonce: 0,
      timer: null,
      lastActivityAt: Date.now(),
      exposure,
    });

    // 1 SOL main bet → 100× worst case → 50 SOL MAX_WIN anchor ≫ ~0.1 SOL cap.
    expect(() =>
      engine.placeBet({
        tableId,
        userId,
        bet: { mainLamports: SOL, side21p3Lamports: 0n, sidePerfectPairsLamports: 0n },
      }),
    ).toThrow(/exposure limit/i);
    expect(exposure.reservedLamports).toBe(0n);

    // A tiny bet (0.0001 SOL × 100× = 0.01 SOL potential) fits…
    const tiny = { mainLamports: SOL / 10_000n, side21p3Lamports: 0n, sidePerfectPairsLamports: 0n };
    expect(engine.placeBet({ tableId, userId, bet: tiny }).previousTotalLamports).toBe(0n);
    expect(exposure.reservedLamports).toBeGreaterThan(0n);

    // …and clearing it releases the reservation for the next player.
    engine.clearBet(tableId, userId);
    expect(exposure.reservedLamports).toBe(0n);
  });

  it('solvency monitor: a near-floor vault emits a low-bankroll alert', async () => {
    const before = (await lowBankrollAlertsTotal.get()).values[0]?.value ?? 0;

    const monitor = new ReconciliationService(prisma as never, fundedChain(NEAR_FLOOR));
    const result = await monitor.houseSolvency();

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false); // 0.5 SOL above floor < 1 SOL buffer
    expect(result!.balanceLamports).toBe(NEAR_FLOOR);
    expect(result!.floorLamports).toBe(RENT_FLOOR + BigInt(HOUSE.MIN_BANKROLL_BUFFER_LAMPORTS));

    const after = (await lowBankrollAlertsTotal.get()).values[0]?.value ?? 0;
    expect(after).toBe(before + 1);

    // A healthy vault (full coverage) does NOT alert.
    const healthy = new ReconciliationService(prisma as never, fundedChain(250n * SOL));
    expect((await healthy.houseSolvency())!.ok).toBe(true);
    expect((await lowBankrollAlertsTotal.get()).values[0]?.value ?? 0).toBe(after);
  });
});
