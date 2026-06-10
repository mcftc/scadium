import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  crashPoint,
  crashPointFromSlot,
  generateServerSeed,
  generateClientSeed,
  commitServerSeed,
  syntheticSlotHash,
} from '@scadium/fair';
import { CRASH, SCAD } from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { withSerializable } from '../../prisma/with-serializable';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';
import { ChainService } from '../../solana/chain.service';
import { RedisService } from '../../redis/redis.service';
import { LeaderElection } from '../../redis/leader-election';
import { CrashGateway } from './crash.gateway';

type Phase = 'waiting' | 'running' | 'busted';

// Leader election (#13/#85): only the lock holder drives the loop; others mirror
// its public round state from Redis so `snapshot()` is consistent across pods.
// On-chain SlotHashes entropy (#101). Pin a slot ~one betting-window ahead so it
// has passed by the time the round starts running and its hash is readable.
// Read live (not at module load) so it's togglable in tests / at runtime.
const onchainEntropyOn = (): boolean => process.env.CRASH_ONCHAIN_ENTROPY === 'true';
const CRASH_ENTROPY_SLOT_DELTA = 50; // ~20s at 400ms/slot
const CRASH_LOCK_KEY = 'lock:engine:crash';
const CRASH_MIRROR_KEY = 'round:crash:current';
const CRASH_LOCK_TTL_MS = 10_000;

/** True when `e` is a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

interface LiveBet {
  userId: string;
  username: string | null;
  walletAddress: string;
  /** REMAINING stake still riding (shrinks on partial cashouts). */
  amountLamports: bigint;
  /** Original stake — the wager for ledger/aggregates. */
  originalAmountLamports: bigint;
  /** Payout accumulated across (partial) cashouts this round. */
  payoutLamports: bigint;
  autoCashout: number | null;
  cashedOutAt: number | null; // multiplier of the FINAL (full) exit
}

interface Round {
  id: string;
  seedId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  bustPoint: number;
  phase: Phase;
  startedAt: number | null; // ms epoch when "running" began
  bets: Map<string, LiveBet>;
  /** Pinned slot whose hash seeds the bust (#101); null on the play-money path. */
  targetSlot: number | null;
}

/** Bet queued for the NEXT round ("Schedule Bet For Next Round"). */
interface ScheduledBet {
  userId: string;
  username: string | null;
  walletAddress: string;
  amountLamports: bigint;
  autoCashout: number | null;
}

/**
 * Background round engine. Drives the crash game independently of any
 * HTTP request: betting window → running tick loop → bust → settle →
 * new round. Broadcasts state via the CrashGateway.
 *
 * The bust point is derived from a committed HMAC-SHA256 seed pair so
 * every round is provably fair — players can verify after reveal.
 */
@Injectable()
export class CrashEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrashEngine.name);
  private current!: Round;
  private history: { bustPoint: number; roundId: string }[] = [];
  /** One queued bet per user, auto-placed when the next round opens. */
  private readonly nextRoundBets = new Map<string, ScheduledBet>();

  // Multi-instance coordination (null in single-instance/test mode → always leader).
  private election: LeaderElection | null = null;
  private mirrored: ReturnType<CrashEngine['buildSnapshot']> | null = null;
  private mirrorPoll: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CrashGateway,
    private readonly chain: ChainService,
    private readonly redis?: RedisService,
  ) {
    if (this.redis) {
      this.election = new LeaderElection(this.redis.client, CRASH_LOCK_KEY, CRASH_LOCK_TTL_MS);
    }
  }

  /** Only the elected leader advances the loop / writes rounds. No Redis = always leader. */
  isLeader(): boolean {
    return this.election ? this.election.isLeader() : true;
  }

  async onModuleInit(): Promise<void> {
    if (!this.election) {
      // Single-instance: drive the loop directly (unchanged behavior).
      await this.recoverStrandedRounds();
      await this.recoverScheduledBets();
      await this.startNewRound();
      return;
    }
    // Multi-instance: a placeholder keeps snapshot() safe until we lead or mirror.
    this.current = this.placeholderRound();
    // Acquire synchronously so a single instance has an open round before
    // onModuleInit resolves (no startup race where a bet beats the first round).
    // start() then only fires assumeLeadership on later leadership TRANSITIONS.
    await this.election.tick();
    if (this.isLeader()) await this.assumeLeadership();
    this.election.start((leader) => {
      if (leader) void this.assumeLeadership();
      else this.logger.warn('crash: lost leadership — standing by');
    });
    // Followers poll the leader's mirrored round so their snapshot stays current.
    this.mirrorPoll = setInterval(() => void this.pollMirror(), 500);
    this.mirrorPoll.unref?.();
  }

  private placeholderRound(): Round {
    return {
      id: '',
      seedId: '',
      serverSeed: '',
      serverSeedHash: '',
      clientSeed: '',
      nonce: 0,
      bustPoint: 0,
      phase: 'waiting',
      startedAt: null,
      bets: new Map(),
      targetSlot: null,
    };
  }

  /** Won the lock: recover any stranded round then drive the loop. */
  private async assumeLeadership(): Promise<void> {
    this.logger.log('crash: elected leader — driving the round loop');
    await this.recoverStrandedRounds();
    await this.recoverScheduledBets();
    await this.startNewRound();
  }

  /** Follower: refresh the mirrored snapshot from the leader's Redis state. */
  private async pollMirror(): Promise<void> {
    if (this.isLeader() || !this.redis) return;
    const raw = await this.redis.client.get(CRASH_MIRROR_KEY).catch(() => null);
    if (raw) this.mirrored = JSON.parse(raw) as ReturnType<CrashEngine['buildSnapshot']>;
  }

  /** Leader: publish the public round snapshot so followers stay consistent. */
  private async mirror(): Promise<void> {
    if (!this.redis) return;
    this.mirrored = this.buildSnapshot();
    await this.redis.client.set(CRASH_MIRROR_KEY, JSON.stringify(this.mirrored)).catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.mirrorPoll) clearInterval(this.mirrorPoll);
    this.mirrorPoll = null;
    if (this.election) await this.election.stop();
  }

  // ---------- Public API consumed by CrashService ----------

  /**
   * The id of the round currently accepting bets (the waiting round). The
   * service needs this to persist a CrashBet row in the same tx as the debit.
   */
  currentRoundId(): string {
    return this.current.id;
  }

  /**
   * Re-assert that the current round's CrashRound (+ its Seed) row exists before
   * a CrashBet is persisted against it. In production this is a no-op fast path
   * (the round was created in startNewRound and only advances after settle) — it
   * exists solely so the bet-time CrashBet insert's FK can never fail if the row
   * was removed out-of-band (e.g. a test harness truncating tables under the
   * live in-RAM round). Idempotent: re-creates round+seed by their known ids.
   */
  async ensureRoundPersisted(): Promise<void> {
    const exists = await this.prisma.crashRound.findUnique({
      where: { id: this.current.id },
      select: { id: true },
    });
    if (exists) return;
    // Re-create seed + round by their known ids. Concurrent callers race here
    // (e.g. 20 simultaneous bets after a harness truncate), so swallow the
    // unique-violation (P2002) that the loser of the create race sees — the row
    // now exists either way, which is all this method promises.
    try {
      await this.prisma.seed.create({
        data: {
          id: this.current.seedId,
          serverSeed: this.current.serverSeed,
          serverSeedHash: this.current.serverSeedHash,
          clientSeed: this.current.clientSeed,
          nonce: this.current.nonce,
        },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
    try {
      await this.prisma.crashRound.create({
        data: {
          id: this.current.id,
          seedId: this.current.seedId,
          nonce: this.current.nonce,
          status: this.current.phase === 'waiting' ? 'waiting' : 'running',
        },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }

  /** Leader serves its live round; a follower serves the leader's mirror. */
  snapshot() {
    if (this.election && !this.isLeader() && this.mirrored) return this.mirrored;
    return this.buildSnapshot();
  }

  private buildSnapshot() {
    return {
      roundId: this.current.id,
      phase: this.current.phase,
      startedAt: this.current.startedAt,
      serverSeedHash: this.current.serverSeedHash,
      // Public, non-secret round inputs — let players reproduce the result.
      clientSeed: this.current.clientSeed,
      nonce: this.current.nonce,
      // serverSeed is only revealed once the round has busted (the commitment
      // is sha256(serverSeed), published up-front via serverSeedHash).
      serverSeed: this.current.phase === 'busted' ? this.current.serverSeed : null,
      bustPoint: this.current.phase === 'busted' ? this.current.bustPoint : null,
      multiplier: this.currentMultiplier(),
      bets: Array.from(this.current.bets.values()).map((b) => ({
        userId: b.userId,
        username: b.username,
        walletAddress: b.walletAddress,
        amountLamports: b.amountLamports.toString(),
        originalAmountLamports: b.originalAmountLamports.toString(),
        payoutLamports: b.payoutLamports.toString(),
        autoCashout: b.autoCashout,
        cashedOutAt: b.cashedOutAt,
      })),
      history: this.history.slice(-20),
    };
  }

  placeBet(params: {
    userId: string;
    username: string | null;
    walletAddress: string;
    amountLamports: bigint;
    autoCashout: number | null;
  }): { ok: true; roundId: string } {
    if (this.current.phase !== 'waiting') {
      throw new Error('Betting window closed');
    }
    if (this.current.bets.has(params.userId)) {
      throw new Error('You already have a bet in this round');
    }
    this.current.bets.set(params.userId, {
      userId: params.userId,
      username: params.username,
      walletAddress: params.walletAddress,
      amountLamports: params.amountLamports,
      originalAmountLamports: params.amountLamports,
      payoutLamports: BigInt(0),
      autoCashout: params.autoCashout,
      cashedOutAt: null,
    });
    this.gateway.emitBetPlaced(this.current.id, params);
    return { ok: true, roundId: this.current.id };
  }

  /**
   * Queue a bet for the NEXT round. Allowed in any phase — players schedule
   * mid-flight when they missed the window, or stack a follow-up while their
   * current bet rides. The caller (service) has already debited the balance,
   * so draining the queue at round start cannot fail.
   */
  scheduleBet(params: {
    userId: string;
    username: string | null;
    walletAddress: string;
    amountLamports: bigint;
    autoCashout: number | null;
  }): { ok: true } {
    if (this.nextRoundBets.has(params.userId)) {
      throw new Error('You already have a bet scheduled for the next round');
    }
    this.nextRoundBets.set(params.userId, { ...params });
    return { ok: true };
  }

  /** Remove the caller's queued bet; returns its stake for the refund. */
  cancelScheduled(userId: string): { amountLamports: bigint } {
    const queued = this.nextRoundBets.get(userId);
    if (!queued) throw new Error('No scheduled bet to cancel');
    this.nextRoundBets.delete(userId);
    return { amountLamports: queued.amountLamports };
  }

  /**
   * Cash out `percent` (10..100) of the REMAINING position at the current
   * multiplier — solpump's "Progressive Cashout". 100% (default) exits the
   * round; partials keep the rest riding.
   */
  async cashOut(
    userId: string,
    percent = 100,
  ): Promise<{ payoutLamports: bigint; multiplier: number; remainingLamports: bigint }> {
    if (this.current.phase !== 'running') {
      throw new Error('Cash out only allowed while running');
    }
    const pct = Math.min(100, Math.max(1, Math.floor(percent)));
    const bet = this.current.bets.get(userId);
    if (!bet) throw new Error('No bet to cash out');
    if (bet.cashedOutAt !== null || bet.amountLamports === BigInt(0)) {
      throw new Error('Already cashed out');
    }

    const m = this.currentMultiplier();
    if (m >= this.current.bustPoint) throw new Error('Too late — round already busting');

    const portion =
      pct >= 100 ? bet.amountLamports : (bet.amountLamports * BigInt(pct)) / BigInt(100);
    if (portion <= BigInt(0)) throw new Error('Position too small to split');

    const payout = (portion * BigInt(Math.floor(m * 100))) / BigInt(100);
    bet.amountLamports -= portion;
    bet.payoutLamports += payout;
    if (bet.amountLamports === BigInt(0)) bet.cashedOutAt = m; // fully out

    // Persist the (partial) cashout to the durable CrashBet row so a restart
    // mid-round refunds only the STILL-RIDING stake and honors locked-in
    // payouts. The row was created at bet time keyed by (roundId, userId).
    const roundId = this.current.id;
    await this.prisma.crashBet.update({
      where: { roundId_userId: { roundId, userId } },
      data: {
        remainingLamports: bet.amountLamports,
        payoutLamports: bet.payoutLamports,
        cashoutMultiplier: bet.cashedOutAt ?? m,
      },
    });

    this.gateway.emitCashedOut(this.current.id, {
      userId,
      // Name fields ride along so the curve can label the cashout marker.
      username: bet.username,
      walletAddress: bet.walletAddress,
      multiplier: m,
      payoutLamports: payout.toString(),
      remainingLamports: bet.amountLamports.toString(),
    });
    return { payoutLamports: payout, multiplier: m, remainingLamports: bet.amountLamports };
  }

  // ---------- Internal loop ----------

  private currentMultiplier(): number {
    if (this.current.phase !== 'running' || this.current.startedAt === null) return 1.0;
    const dt = Date.now() - this.current.startedAt;
    // m(t_ms) = 1.00024^t — same curve as @scadium/fair:crashMultiplierAt
    const m = Math.max(1.0, 1.00024 ** dt);
    return Number(m.toFixed(2));
  }

  private async startNewRound(): Promise<void> {
    if (!this.isLeader()) return; // never create a round as a non-leader
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const nonce = 0;
    // Flag on: defer the bust to beginRun (derived from a slot hash that does not
    // exist at commit, #101). Flag off: today's behaviour — bust committed up front.
    const entropyOn = onchainEntropyOn();
    const targetSlot = entropyOn
      ? ((await this.chain.currentSlot()) ?? 0) + CRASH_ENTROPY_SLOT_DELTA
      : null;
    const bustPoint = entropyOn ? 0 : crashPoint(serverSeed, clientSeed, nonce);

    const seed = await this.prisma.seed.create({
      data: {
        serverSeed,
        serverSeedHash: commitServerSeed(serverSeed),
        clientSeed,
        nonce,
      },
    });

    const round = await this.prisma.crashRound.create({
      data: {
        seedId: seed.id,
        nonce,
        status: 'waiting',
        ...(entropyOn
          ? { entropyStatus: 'entropy_requested', targetSlot: BigInt(targetSlot ?? 0) }
          : {}),
      },
    });

    this.current = {
      id: round.id,
      seedId: seed.id,
      serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed,
      nonce,
      bustPoint,
      phase: 'waiting',
      startedAt: null,
      bets: new Map(),
      targetSlot,
    };

    this.gateway.emitRoundStart({
      roundId: this.current.id,
      phase: 'waiting',
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
      bettingWindowMs: CRASH.BET_WINDOW_MS,
    });

    // Drain scheduled bets into the fresh round. Balances were debited at
    // schedule time, so placement cannot fail; emit AFTER round-start so
    // clients see the bets land in the new round. A durable CrashBet row is
    // created per placed bet (the round id is only known now) so a restart can
    // refund the stranded stake — mirroring placeBet's bet-time persistence.
    for (const queued of this.nextRoundBets.values()) {
      try {
        this.placeBet(queued);
        // Bind the durable stake to this round and drop the ScheduledCrashBet in
        // ONE tx (#72), so boot recovery can never see BOTH a CrashBet and a
        // ScheduledCrashBet for the same user (which would double-refund).
        await withSerializable(this.prisma, async (tx) => {
          await tx.crashBet.create({
            data: {
              roundId: this.current.id,
              userId: queued.userId,
              amountLamports: queued.amountLamports,
              remainingLamports: queued.amountLamports,
              autoCashoutMultiplier: queued.autoCashout,
              payoutLamports: BigInt(0),
              won: false,
            },
          });
          // `delete` (NOT deleteMany): if the row is already gone, a concurrent
          // cancelScheduled won the race and already refunded this stake — the
          // delete throws P2025, the whole tx (incl. the CrashBet create) rolls
          // back, and the catch below pulls the user out of the round. Using
          // deleteMany here would silently match 0 rows, let the CrashBet commit,
          // and double-credit (round payout + cancel refund).
          await tx.scheduledCrashBet.delete({ where: { userId: queued.userId } });
        });
      } catch (e) {
        // Durable write failed (DB error) OR the bet was cancelled concurrently
        // (P2025 on the delete). Either way, undo the in-memory placement so the
        // user does NOT ride this round on an unrecorded/refunded stake. If a
        // ScheduledCrashBet row survives (DB error, not a cancel),
        // recoverScheduledBets refunds it on the next boot — never both.
        this.logger.warn(
          `scheduled bet for ${queued.userId} not placed into round ${this.current.id}: ${e instanceof Error ? e.message : e}`,
        );
        this.current.bets.delete(queued.userId);
      }
    }
    this.nextRoundBets.clear();
    void this.mirror(); // publish the fresh waiting round to followers

    // Betting window → run
    setTimeout(() => {
      void this.beginRun();
    }, CRASH.BET_WINDOW_MS);
  }

  /**
   * Derive the bust from the pinned slot's hash once it has passed (#101). On a
   * live chain the hash is read from the SlotHashes sysvar; if it's unavailable
   * (timeout / play-money mode) we fall back to a deterministic synthetic hash so
   * NO bets are ever stranded (documented fallback, ADR 0002 — that round is then
   * non-fair; the production VRF path #102 does a hard void/refund instead).
   * Deterministic, so re-running it is idempotent.
   */
  private async fulfillEntropy(): Promise<void> {
    const { serverSeed, clientSeed, nonce, targetSlot } = this.current;
    let slotHashHex = targetSlot !== null ? await this.chain.readSlotHash(targetSlot) : null;
    if (!slotHashHex) {
      if (this.chain.enabled) {
        this.logger.warn(`crash ${this.current.id}: slot ${targetSlot} hash unavailable — synthetic fallback`);
      }
      slotHashHex = syntheticSlotHash(serverSeed, clientSeed).toString('hex');
    }
    this.current.bustPoint = crashPointFromSlot(
      serverSeed,
      clientSeed,
      Buffer.from(slotHashHex, 'hex'),
      nonce,
    );
    await this.prisma.crashRound.update({
      where: { id: this.current.id },
      data: { slotHash: slotHashHex, entropyStatus: 'entropy_fulfilled' },
    });
  }

  private async beginRun(): Promise<void> {
    if (!this.isLeader()) return; // leadership lost during the betting window
    if (onchainEntropyOn()) await this.fulfillEntropy(); // derive the deferred bust
    this.current.phase = 'running';
    this.current.startedAt = Date.now();
    await this.prisma.crashRound.update({
      where: { id: this.current.id },
      data: { status: 'running', startedAt: new Date(this.current.startedAt) },
    });
    this.gateway.emitRunning(this.current.id);
    void this.mirror();

    // Tick loop at 20 Hz — server authoritative
    const tickInterval = 1000 / CRASH.TICK_RATE_HZ;
    const tick = async (): Promise<void> => {
      if (!this.isLeader()) return; // stop driving if we lost the lock mid-round
      const m = this.currentMultiplier();

      // Auto-cashouts (full exit of whatever is still riding). Awaited so the
      // CrashBet row is persisted before bust settles the round.
      for (const bet of this.current.bets.values()) {
        if (
          bet.cashedOutAt === null &&
          bet.amountLamports > BigInt(0) &&
          bet.autoCashout !== null &&
          m >= bet.autoCashout
        ) {
          try {
            await this.cashOut(bet.userId);
          } catch {
            /* noop */
          }
        }
      }

      if (m >= this.current.bustPoint) {
        void this.bust();
        return;
      }
      this.gateway.emitTick(this.current.id, m);
      setTimeout(() => void tick(), tickInterval);
    };
    setTimeout(() => void tick(), tickInterval);
  }

  private async bust(): Promise<void> {
    if (!this.isLeader()) return;
    this.current.phase = 'busted';
    const bustM = this.current.bustPoint;
    this.history.unshift({ bustPoint: bustM, roundId: this.current.id });
    this.history = this.history.slice(0, 50);

    // Settle the ledger for all bets. The `busted` round flip + seed reveal now
    // happen INSIDE this transaction (see settleRound) so a round is never
    // marked terminal without its ledger writes landing atomically.
    const settled = await this.settleRound();

    if (!settled) {
      // Unrecoverable settlement failure: the round stays non-terminal
      // (status left 'running'/'waiting', seed unrevealed) for the recovery
      // worker. Do NOT emit bust and do NOT advance to a new round.
      return;
    }

    this.gateway.emitBust({
      roundId: this.current.id,
      bustPoint: bustM,
      serverSeed: this.current.serverSeed,
    });
    void this.mirror(); // publish busted state (seed/bustPoint now revealed)

    // Fire on-chain settlement receipts AFTER the ledger tx commits
    // (fire-and-forget — never blocks the loop; no-op when disabled).
    if (this.chain.enabled) {
      for (const job of settled.settleJobs) {
        void this.chain
          .settleBet({
            betId: job.betId,
            walletAddress: job.walletAddress,
            game: 'crash',
            stakeLamports: job.stake,
            payoutLamports: job.payout,
            multiplier: job.multiplier,
          })
          .then(async (sig) => {
            if (sig) {
              await this.prisma.bet.update({
                where: { id: job.betId },
                data: { txSignature: sig },
              });
            }
          })
          .catch((e: unknown) =>
            this.logger.error(`on-chain settle failed for ${job.betId}: ${String(e)}`),
          );
      }
    }

    // Short gap then next round — ONLY on a committed settlement.
    setTimeout(() => {
      void this.startNewRound();
    }, 3_000);
  }

  /**
   * Settle every bet of the busted round in ONE serializable transaction:
   * per-user ledger update + CrashBet row + Bet row + the round `busted` flip +
   * the seed reveal. Returns the on-chain settle jobs (data only) on success,
   * or null if the transaction failed after retries (a SettlementFailure
   * dead-letter row is written and the round is left non-terminal).
   */
  private async settleRound(): Promise<{
    settleJobs: {
      betId: string;
      walletAddress: string;
      stake: bigint;
      payout: bigint;
      multiplier: number;
    }[];
  } | null> {
    const bets = Array.from(this.current.bets.values());
    const bustM = this.current.bustPoint;

    // Pre-generate bet ids so the post-commit on-chain receipts can reference
    // them without re-querying, and collect chain jobs as DATA ONLY.
    const settleJobs: {
      betId: string;
      walletAddress: string;
      stake: bigint;
      payout: bigint;
      multiplier: number;
    }[] = bets.map((bet) => ({
      betId: randomUUID(),
      walletAddress: bet.walletAddress,
      stake: bet.originalAmountLamports,
      payout: bet.payoutLamports,
      multiplier: bet.cashedOutAt ?? bustM,
    }));

    try {
      await withSerializable(this.prisma, async (tx) => {
        for (let i = 0; i < bets.length; i += 1) {
          const bet = bets[i]!;
          const job = settleJobs[i]!;
          // Progressive cashout: payouts accumulated across partial exits; any
          // stake still riding at bust is lost. won = walked away with anything.
          const stake = bet.originalAmountLamports;
          const payout = bet.payoutLamports;
          const won = payout > BigInt(0);
          const netProfit = payout - stake;

          await tx.user.update({
            where: { id: bet.userId },
            data: {
              // Wager mining: 128 SCAD per SOL wagered (base units = lamports × 128)
              scadiumBalance: { increment: stake * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT) },
              totalWagered: { increment: stake },
              totalWon: { increment: netProfit > BigInt(0) ? netProfit : BigInt(0) },
              totalLost: { increment: netProfit < BigInt(0) ? -netProfit : BigInt(0) },
              gamesPlayed: { increment: 1 },
            },
          });

          // Credit the play balance through the single mutation point (writes a
          // ledger row in this tx). Only when there's an actual payout — a pure
          // loss has no balance movement.
          if (payout > BigInt(0)) {
            await applyBalanceDelta(tx, bet.userId, payout, {
              reason: 'crash_settle',
              refType: 'Bet',
              refId: job.betId,
            });
          }

          // The CrashBet row exists from bet time (unique on roundId+userId);
          // UPSERT it with the final outcome — update in production, create as a
          // fallback for direct-engine paths that didn't persist at bet time.
          // Any stake still riding at bust is lost, so remainingLamports → 0.
          await tx.crashBet.upsert({
            where: { roundId_userId: { roundId: this.current.id, userId: bet.userId } },
            update: {
              cashoutMultiplier: bet.cashedOutAt,
              payoutLamports: payout,
              remainingLamports: BigInt(0),
              won,
            },
            create: {
              roundId: this.current.id,
              userId: bet.userId,
              amountLamports: stake,
              autoCashoutMultiplier: bet.autoCashout,
              cashoutMultiplier: bet.cashedOutAt,
              payoutLamports: payout,
              remainingLamports: BigInt(0),
              won,
            },
          });

          await tx.bet.create({
            data: {
              id: job.betId,
              userId: bet.userId,
              gameType: 'crash',
              amountLamports: stake,
              payoutLamports: payout,
              multiplier:
                stake > BigInt(0) && payout > BigInt(0)
                  ? Number(payout) / Number(stake)
                  : bet.cashedOutAt ?? bustM,
              status: won ? 'won' : 'lost',
              seedId: this.current.seedId,
              nonce: this.current.nonce,
              resultJson: {
                bustPoint: bustM,
                cashedOutAt: bet.cashedOutAt,
                partialPayouts: payout.toString(),
                // Self-contained verification context (ADR 0001 / #93): the
                // revealed per-round house seed pair so the bet reproduces the
                // shared bust via crashPoint() without a Seed-table join.
                fair: {
                  serverSeed: this.current.serverSeed,
                  serverSeedHash: this.current.serverSeedHash,
                  clientSeed: this.current.clientSeed,
                  nonce: this.current.nonce,
                },
              },
            },
          });
        }

        // Round terminal flip + seed reveal: INSIDE the tx so the round can
        // never be 'busted' without its ledger writes (and vice versa).
        await tx.crashRound.update({
          where: { id: this.current.id },
          data: { status: 'busted', bustMultiplier: bustM, endedAt: new Date() },
        });
        await tx.seed.update({
          where: { id: this.current.seedId },
          data: { revealedAt: new Date() },
        });
      });
    } catch (e) {
      this.logger.error(
        `Failed to settle crash round ${this.current.id} after retries: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      // Best-effort dead-letter write — must never crash the loop itself.
      try {
        await this.prisma.settlementFailure.create({
          data: {
            gameType: 'crash',
            roundId: this.current.id,
            payloadJson: {
              roundId: this.current.id,
              bustPoint: bustM,
              bets: bets.map((b) => ({
                userId: b.userId,
                stake: b.originalAmountLamports.toString(),
                payout: b.payoutLamports.toString(),
                cashedOutAt: b.cashedOutAt,
                autoCashout: b.autoCashout,
              })),
            },
            error: e instanceof Error ? e.message : String(e),
          },
        });
      } catch (deadLetterErr) {
        this.logger.error(
          `Failed to write SettlementFailure for crash round ${this.current.id}: ${String(
            deadLetterErr,
          )}`,
        );
      }
      return null;
    }

    return { settleJobs };
  }

  /**
   * Boot recovery (#14): a restart strands every round left 'waiting'/'running'
   * — debited stakes (and any in-RAM cashout that was persisted to the CrashBet
   * row) would otherwise be lost. For each stranded round, in ONE serializable
   * tx: credit each bet's locked-in payout PLUS refund its still-riding
   * remaining stake, mark the CrashBet terminal, write the unified Bet row, then
   * flip the round 'busted' + reveal the seed. Value-conserving: a never-cashed
   * bet refunds its full original stake (net zero); a cashed bet keeps winnings
   * plus any remaining stake. Defensive per-round: a failure dead-letters a
   * SettlementFailure and continues so boot never hangs or throws.
   */
  private async recoverStrandedRounds(): Promise<void> {
    let stranded: { id: string; seedId: string }[];
    try {
      stranded = await this.prisma.crashRound.findMany({
        where: { status: { in: ['waiting', 'running'] } },
        select: { id: true, seedId: true },
        orderBy: { createdAt: 'asc' },
      });
    } catch (e) {
      this.logger.error(`crash recovery scan failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (stranded.length === 0) return;
    this.logger.warn(`crash recovery: ${stranded.length} stranded round(s) — settling`);

    for (const round of stranded) {
      try {
        const bets = await this.prisma.crashBet.findMany({ where: { roundId: round.id } });
        await withSerializable(this.prisma, async (tx) => {
          for (const bet of bets) {
            const payout = bet.payoutLamports; // locked-in (partial) cashouts
            const refund = bet.remainingLamports; // still-riding stake
            const credit = payout + refund;
            const won = payout > BigInt(0);
            if (credit > BigInt(0)) {
              await applyBalanceDelta(tx, bet.userId, credit, {
                reason: 'crash_recovery_refund',
                refType: 'CrashRound',
                refId: round.id,
              });
            }
            await tx.crashBet.update({
              where: { id: bet.id },
              data: { payoutLamports: payout, remainingLamports: BigInt(0), won },
            });
            await tx.bet.create({
              data: {
                userId: bet.userId,
                gameType: 'crash',
                amountLamports: bet.amountLamports,
                payoutLamports: credit,
                multiplier:
                  bet.amountLamports > BigInt(0) && credit > BigInt(0)
                    ? Number(credit) / Number(bet.amountLamports)
                    : null,
                status: won ? 'won' : 'lost',
                seedId: round.seedId,
                nonce: 0,
                resultJson: {
                  recovered: true,
                  payoutLamports: payout.toString(),
                  refundedLamports: refund.toString(),
                },
              },
            });
          }
          await tx.crashRound.update({
            where: { id: round.id },
            data: { status: 'busted', endedAt: new Date() },
          });
          await tx.seed.update({ where: { id: round.seedId }, data: { revealedAt: new Date() } });
        });
        this.logger.log(`crash recovery: round ${round.id} settled (${bets.length} bet(s))`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(`crash recovery failed for round ${round.id}: ${message}`);
        try {
          await this.prisma.settlementFailure.create({
            data: {
              gameType: 'crash',
              roundId: round.id,
              payloadJson: { roundId: round.id, path: 'recovery' },
              error: message,
            },
          });
        } catch (deadLetterErr) {
          this.logger.error(
            `crash recovery: failed to write SettlementFailure for ${round.id}: ${String(deadLetterErr)}`,
          );
        }
      }
    }
  }

  /**
   * Boot recovery for scheduled (next-round) bets (#72). The in-memory
   * `nextRoundBets` queue is lost on restart, so every persisted
   * `ScheduledCrashBet` is an orphan whose stake was debited but never bound to
   * a round (a drained bet deletes its row atomically with the CrashBet write).
   * Refund each and delete it in one tx. Idempotent: the row is gone after the
   * refund, so a re-run credits nothing.
   */
  private async recoverScheduledBets(): Promise<void> {
    let scheduled: { id: string; userId: string; amountLamports: bigint }[];
    try {
      scheduled = await this.prisma.scheduledCrashBet.findMany({
        select: { id: true, userId: true, amountLamports: true },
        orderBy: { createdAt: 'asc' },
      });
    } catch (e) {
      this.logger.error(
        `crash scheduled-bet recovery scan failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (scheduled.length === 0) return;
    this.logger.warn(`crash recovery: refunding ${scheduled.length} orphaned scheduled bet(s)`);

    for (const s of scheduled) {
      try {
        await withSerializable(this.prisma, async (tx) => {
          if (s.amountLamports > BigInt(0)) {
            await applyBalanceDelta(tx, s.userId, s.amountLamports, {
              reason: 'crash_scheduled_refund',
              refType: 'CrashRound',
              refId: null,
            });
          }
          await tx.scheduledCrashBet.delete({ where: { id: s.id } });
        });
        this.logger.log(`crash recovery: refunded orphaned scheduled bet ${s.id}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(`crash scheduled-bet recovery failed for ${s.id}: ${message}`);
        try {
          await this.prisma.settlementFailure.create({
            data: {
              gameType: 'crash',
              roundId: s.id,
              payloadJson: { scheduledBetId: s.id, userId: s.userId, path: 'scheduled-recovery' },
              error: message,
            },
          });
        } catch (deadLetterErr) {
          this.logger.error(
            `crash recovery: failed to write SettlementFailure for scheduled bet ${s.id}: ${String(deadLetterErr)}`,
          );
        }
      }
    }
  }
}
