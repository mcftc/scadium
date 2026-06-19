import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { bootstrapApp, resetDb, seedUser, getPrisma, type BootstrapResult } from '../setup';
import { ReconciliationService } from '../../src/reconciliation/reconciliation.service';
import { LotteryEngine } from '../../src/games/lottery/lottery.engine';
import { ChainService } from '../../src/solana/chain.service';

/**
 * Chaos suite (#179, slice of #55) — lottery VRF / on-chain reveal callback
 * failure, VERIFIED BY RECONCILIATION (balance conservation).
 *
 * REAL MECHANISM EXERCISED (premise note): the issue asks for
 * `chain.lotteryRevealDraw` "stubbed to return null once then succeed; the draw
 * retries/reconciles and no ticket buyer is debited without a resolved/refunded
 * outcome." The genuine product behaviour (apps/api/src/games/lottery/
 * lottery.engine.ts:drawAndSettle) is NOT a reveal retry loop — when
 * `lotteryRevealDraw` returns null the engine falls back to a DOCUMENTED
 * synthetic slot hash (ADR 0002, flagged `synthetic-not-fair`) and settles the
 * draw ATOMICALLY in the same serializable transaction (#19a). So the real
 * guarantee a null reveal must preserve is: a failed reveal callback NEVER
 * strands a ticket buyer — every ticket of the draw still gets a terminal
 * won/lost `Bet` row and the draw flips `drawn`, with the buyer's stake fully
 * accounted (balance == ledger == aggregates, zero drift). This spec asserts
 * that real guarantee, AND that the very next draw — where the reveal SUCCEEDS —
 * also settles cleanly (the "then succeed" half).
 *
 * (Discrepancy reported to the orchestrator: the issue's "retries" wording does
 * not match the code; the code reconciles via synthetic-fallback + the
 * reconcile sweep for on-chain prize payouts, not a reveal retry.)
 *
 * RED-BEFORE: fails if a null reveal aborts settlement (leaving the draw `open`
 * and tickets unresolved) instead of falling back — the buyer would be debited
 * with no resolved outcome and reconciliation would drift.
 */
describe('chaos: lottery reveal-callback failure (reconciliation-verified)', () => {
  let harness: BootstrapResult;
  const prisma = getPrisma();
  const reconciliation = new ReconciliationService(
    prisma as never,
    { enabled: false, lotteryEnabled: false } as never,
  );

  let revealCalls = 0;

  beforeAll(async () => {
    harness = await bootstrapApp();

    // Patch the REAL ChainService instance (no fake program code paths): turn the
    // on-chain lottery "on" so `lotteryRevealDraw` is actually invoked, make the
    // first reveal FAIL (null) then SUCCEED, and no-op every other on-chain side
    // effect so no real RPC fires. The engine's settlement/ledger logic is
    // untouched — only the chain boundary is stubbed.
    const chain = harness.app.get(ChainService, { strict: false }) as unknown as Record<
      string,
      unknown
    >;
    Object.defineProperty(chain, 'lotteryEnabled', { get: () => true, configurable: true });
    Object.defineProperty(chain, 'enabled', { get: () => false, configurable: true });
    chain.currentSlot = async () => 1_000;
    chain.lotteryCommitDraw = async () => 'chaos-commit-sig';
    chain.lotteryInject = async () => 'chaos-inject-sig';
    chain.lotteryBurnPool = async () => 'chaos-burn-sig';
    chain.lotteryTreasuryBalance = async () => BigInt('1000000000000000000'); // ample → no solvency defer
    chain.lotteryPayPrize = async () => 'chaos-prize-sig';
    // Default reveal callback: FAIL (null) — the failure case. The "then succeed"
    // case overrides this stub with a digit-returning success in its own test.
    chain.lotteryRevealDraw = async (params: { drawIndex: bigint; serverSeedHex?: string }) => {
      void params;
      revealCalls += 1;
      return null; // VRF/reveal callback failure → synthetic-fallback settlement
    };
  });

  afterAll(async () => {
    await harness.app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    revealCalls = 0;
  });

  it('reveal returns null → draw still settles via fallback, buyer resolved, zero drift', async () => {
    const engine = harness.app.get(LotteryEngine, { strict: false });

    // Re-open a draw under the patched (enabled) chain so the on-chain reveal
    // path is the one that runs at settle. resetDb truncated the boot draw.
    await (engine as unknown as { openNewDraw: () => Promise<void> }).openNewDraw();
    const open = engine.getOpenDraw();
    expect(open).not.toBeNull();

    // The null-reveal fallback derives the winning number from a SYNTHETIC slot
    // hash over the committed seed pair (lottery.engine.ts). Reproduce it here so
    // we can hand the buyer a DETERMINISTIC losing pick (first digit differs →
    // matchLen 0 → no bracket), keeping the reconcile assertion exact.
    const { lotteryDraw, padClientSeed32, syntheticSlotHash } = await import('@scadium/fair');
    const drawRow = await prisma.lotteryDraw.findUniqueOrThrow({
      where: { id: open!.id },
      include: { seed: true },
    });
    const synthetic = syntheticSlotHash(drawRow.seed.serverSeed!, drawRow.seed.clientSeed);
    const syntheticDigits = lotteryDraw(
      drawRow.seed.serverSeed!,
      padClientSeed32(drawRow.seed.clientSeed),
      synthetic,
      drawRow.nonce,
    ).digits;
    const losingDigits = [(syntheticDigits[0]! + 1) % 10, 0, 0, 0, 0, 0];

    // Seed a ticket buyer. Lottery tickets are $SCAD-denominated; the buyer is
    // debited at purchase time (off-chain mirror), so the conservation invariant
    // here is "the buyer ends with a RESOLVED ticket (won/lost Bet row) and the
    // draw is terminal" — never debited-but-unresolved.
    const priceScad = engine.ticketPriceScadBase();
    const priceLamports = BigInt(1_000_000); // mirror lamports for the Bet/aggregate math
    const { user } = await seedUser(BigInt(0), harness.signToken, prisma);

    // Persist the ticket + register it with the engine exactly as the buy path
    // does (the on-chain confirm path also inserts the LotteryTicket then calls
    // onTicketSold).
    await prisma.lotteryTicket.create({
      data: {
        drawId: open!.id,
        userId: user.id,
        digits: losingDigits,
        costScadBase: priceScad,
        costLamports: priceLamports,
      },
    });
    await engine.onTicketSold(priceScad, priceLamports, 1);

    // Resolve the draw NOW. lotteryRevealDraw is invoked and returns null → the
    // engine must fall back to the synthetic slot hash and settle atomically.
    await engine.forceDraw();

    expect(revealCalls).toBeGreaterThanOrEqual(1); // the reveal callback DID run

    // INVARIANT 1: the draw is terminal (drawn), flagged as the non-fair synthetic
    // fallback — not stuck `open` after the failed reveal.
    const draw = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: open!.id } });
    expect(draw.status).toBe('drawn');
    expect(draw.fairness).toBe('synthetic-not-fair');
    expect(draw.winningDigits.length).toBe(6);

    // INVARIANT 2: the buyer has a RESOLVED outcome — a settled ticket + a
    // terminal Bet row. No ticket buyer is left debited-without-resolution. The
    // pick is a deterministic loss, so it resolves cleanly to `lost`.
    const ticket = await prisma.lotteryTicket.findFirstOrThrow({
      where: { drawId: open!.id, userId: user.id },
    });
    expect(ticket.won).toBe(false);
    expect(ticket.matchLen).toBe(0);
    const bet = await prisma.bet.findFirstOrThrow({
      where: { userId: user.id, gameType: 'lottery' },
    });
    expect(bet.status).toBe('lost');

    // INVARIANT 3 (the §9 gating assertion): reconciliation reports ZERO drift
    // after settling through the failed reveal callback.
    const drift = await reconciliation.reconcileAll();
    expect(drift).toBe(0);
  });

  it('reveal succeeds on a later draw → settles cleanly, zero drift (the "then succeed" half)', async () => {
    const engine = harness.app.get(LotteryEngine, { strict: false });
    const chain = harness.app.get(ChainService, { strict: false }) as unknown as Record<
      string,
      unknown
    >;

    // For this case the reveal SUCCEEDS: return on-chain digits + a slot hash the
    // engine's lockstep cross-check can reproduce. We derive the digits the same
    // way the engine does so the local/on-chain check agrees. The success stub is
    // installed below, once the draw's committed seed is known.
    const { lotteryDraw, padClientSeed32, syntheticSlotHash } = await import('@scadium/fair');

    await (engine as unknown as { openNewDraw: () => Promise<void> }).openNewDraw();
    const open = engine.getOpenDraw();
    expect(open).not.toBeNull();

    // Read the committed seed pair for THIS draw so the stubbed reveal can return
    // digits that match the engine's local derivation (lockstep cross-check).
    const drawRow = await prisma.lotteryDraw.findUniqueOrThrow({
      where: { id: open!.id },
      include: { seed: true },
    });
    const serverSeed = drawRow.seed.serverSeed!;
    const clientSeed = drawRow.seed.clientSeed;
    const slotHash = syntheticSlotHash(serverSeed, clientSeed);
    const slotHashHex = slotHash.toString('hex');
    const onchainDigits = lotteryDraw(
      serverSeed,
      padClientSeed32(clientSeed),
      slotHash,
      drawRow.nonce,
    ).digits;
    chain.lotteryRevealDraw = async () => ({
      signature: 'chaos-reveal-sig',
      digits: onchainDigits,
      slotHashHex,
      finalEntropyHex: slotHashHex,
    });

    const { user } = await seedUser(BigInt(0), harness.signToken, prisma);
    const priceScad = engine.ticketPriceScadBase();
    // Pick digits whose FIRST digit differs from the winning number so the ticket
    // is a DETERMINISTIC loss (leading-prefix match → matchLen 0 → no bracket).
    // A loser keeps the reconcile assertion exact regardless of the derived draw.
    const losingDigits = [(onchainDigits[0]! + 1) % 10, 0, 0, 0, 0, 0];
    await prisma.lotteryTicket.create({
      data: {
        drawId: open!.id,
        userId: user.id,
        digits: losingDigits,
        costScadBase: priceScad,
        costLamports: BigInt(1_000_000),
      },
    });
    await engine.onTicketSold(priceScad, BigInt(1_000_000), 1);

    await engine.forceDraw();

    const draw = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: open!.id } });
    expect(draw.status).toBe('drawn');
    expect(draw.fairness).toBe('onchain'); // the successful reveal path
    expect(draw.revealTxSignature).toBe('chaos-reveal-sig');

    const bet = await prisma.bet.findFirstOrThrow({
      where: { userId: user.id, gameType: 'lottery' },
    });
    expect(bet.status).toBe('lost'); // deterministic non-matching pick

    const drift = await reconciliation.reconcileAll();
    expect(drift).toBe(0);
  });
});
