import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import {
  commitServerSeed,
  deriveSeedContext,
  generateClientSeed,
  generateServerSeed,
  jackpotRanges,
  jackpotWinningTicket,
} from '@scadium/fair';
import { JACKPOT } from '@scadium/shared';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ProofOfWagerService } from '../../proof-of-wager/proof-of-wager.service';
import { AffiliatesService } from '../../affiliates/affiliates.service';
import { withSerializable } from '../../prisma/with-serializable';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';
import { ChainService } from '../../solana/chain.service';
import { OnchainRngService } from '../../solana/onchain-rng.service';
import { RedisService } from '../../redis/redis.service';
import { LeaderElection } from '../../redis/leader-election';
import { JackpotGateway } from './jackpot.gateway';
import { LiveFeedService } from '../../live/live-feed.service';
import { settlementsTotal } from '../../observability/metrics.registry';
import { assertRoundClaimed, assertStillLeader, isSettleClaimLost } from '../settle-claim';
import {
  RoundTimers,
  errMessage,
  retryDelayMs,
  roundLoopTuning,
  settleTxOptions,
} from '../round-loop';
import { DEMO_BOTS, DEMO_BOT_BALANCE, demoBotsEnabled } from '../bots/demo-bots.const';
import { displayHandle, publicPlayerId } from '../../common/public-player';

/**
 * One entry's slice of the pot, as persisted with the drawn round and sent with
 * the result: the ticket range [start, end) plus the PUBLIC identity of its
 * owner. With the winning ticket, this is everything needed to check the winner.
 */
export type JackpotRangeRow = {
  playerId: string;
  player: string;
  amountLamports: string;
  start: string;
  end: string;
};

// Single-writer election (#13/#86): only the lock holder opens/draws rounds, so
// N replicas never produce duplicate JackpotRound rows. No Redis → always leader.
const JACKPOT_LOCK_KEY = 'lock:engine:jackpot';
const JACKPOT_LOCK_TTL_MS = 10_000;

interface CurrentRound {
  id: string;
  seedId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  /**
   * When entries close and the draw runs. Null until the first entry: the clock
   * only starts once someone is in. One player → the solo deadline (refund if
   * nobody joins); the MIN_PLAYERS-th distinct player → the real countdown.
   */
  closeAt: number | null;
  status: 'open' | 'drawn' | 'refunded';
  totalLamports: bigint;
  players: Set<string>; // distinct userIds (for the live player count)
}

interface LastResult {
  roundId: string;
  status: 'drawn' | 'refunded';
  winnerName: string | null;
  payoutLamports: string;
  totalLamports: string;
  winningTicket: string | null;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  drawnAt: number;
}

/** A stored round, as recovery reads it. */
type StoredRound = { id: string; seedId: string; closeAt: Date | null };

/**
 * Singleton jackpot scheduler (pot-style raffle). A round opens and waits for
 * players; the MIN_PLAYERS-th distinct player starts a ROUND_WINDOW_MS
 * countdown, then a provably-fair ticket in [0, totalLamports) selects the
 * winner — the player whose cumulative contribution range contains the ticket
 * takes 95% of the pot. A lone entry waits up to SOLO_WAIT_MS for company and
 * is then refunded.
 *
 * Like the crash/lottery engines it owns the only live round in memory and
 * settles from the DB so a restart can't lose entries.
 */
@Injectable()
export class JackpotEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JackpotEngine.name);
  private current!: CurrentRound;
  private lastResult: LastResult | null = null;
  private election: LeaderElection | null = null;
  /** True while replaying stranded rounds on boot — suppresses the chained
   * openNewRound() in drawAndSettle so onModuleInit opens exactly one fresh
   * round after all stranded rounds settle. */
  private recovering = false;

  // Liveness (see round-loop.ts).
  private readonly timers = new RoundTimers();
  private watchdog: NodeJS.Timeout | null = null;
  private settling = false;
  /** Consecutive failed settles of the current round — drives backoff and the refund fallback. */
  private settleFailures = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: JackpotGateway,
    private readonly chain: ChainService,
    private readonly proofOfWager: ProofOfWagerService,
    private readonly affiliates: AffiliatesService,
    private readonly redis?: RedisService,
    // Optional shared on-chain RNG driver (the @Global SolanaModule supplies it);
    // when live the winning ticket is anchored on the ONE scadium_rng program.
    @Optional() private readonly onchainRng?: OnchainRngService,
    // Optional sitewide live-bet feed (the @Global LiveModule supplies it).
    @Optional() private readonly liveFeed?: LiveFeedService,
  ) {
    if (this.redis) {
      this.election = new LeaderElection(this.redis.client, JACKPOT_LOCK_KEY, JACKPOT_LOCK_TTL_MS);
    }
  }

  /** Only the elected leader opens/draws rounds. No Redis = always leader. */
  isLeader(): boolean {
    return this.election ? this.election.isLeader() : true;
  }

  private get demoBots(): boolean {
    return demoBotsEnabled();
  }

  async onModuleInit(): Promise<void> {
    // Demo bots are a local convenience — never let them break API boot.
    if (this.demoBots) {
      try {
        await this.ensureBots();
      } catch (e) {
        this.logger.error(`demo bots init failed (disabling): ${String(e)}`);
      }
    }
    this.startWatchdog();
    if (!this.election) {
      await this.bootRounds();
      return;
    }
    // Multi-instance: placeholder keeps reads safe until we lead; only the leader
    // opens rounds. (Cross-pod live state is wired in #87.)
    this.current = this.placeholderRound();
    // Acquire synchronously so a single instance has an open round before init
    // resolves; start() then fires only on later leadership transitions.
    await this.election.tick();
    if (this.isLeader()) await this.assumeLeadership();
    this.election.start((leader) => {
      if (leader) this.guard(this.assumeLeadership(), 'assume leadership');
      else {
        this.timers.reset();
        this.logger.warn('jackpot: lost leadership — standing by');
      }
    });
  }

  private placeholderRound(): CurrentRound {
    return {
      id: '',
      seedId: '',
      serverSeed: '',
      serverSeedHash: '',
      clientSeed: '',
      nonce: 0,
      closeAt: null,
      status: 'open',
      totalLamports: BigInt(0),
      players: new Set(),
    };
  }

  /** Idempotently create the demo bot users with a big play balance. */
  private async ensureBots(): Promise<void> {
    let ready = 0;
    for (const bot of DEMO_BOTS) {
      try {
        await this.prisma.user.upsert({
          where: { id: bot.id },
          update: { playBalanceLamports: DEMO_BOT_BALANCE },
          create: {
            id: bot.id,
            username: bot.username,
            walletAddress: bot.wallet,
            refCode: `bot${bot.id.slice(-4)}`,
            playBalanceLamports: DEMO_BOT_BALANCE,
          },
        });
        ready++;
      } catch (e) {
        this.logger.warn(`demo bot ${bot.username} not provisioned: ${String(e)}`);
      }
    }
    this.logger.log(`jackpot demo bots ready (${ready}/${DEMO_BOTS.length})`);
  }

  /** Auto-join a couple of bots into the open round so a draw happens. */
  private async fillBots(roundId: string): Promise<void> {
    if (!this.demoBots || !this.isLeader()) return;
    if (this.current.id !== roundId || this.current.status !== 'open') return;
    const shuffled = [...DEMO_BOTS].sort(() => Math.random() - 0.5);
    const count = 2 + Math.floor(Math.random() * 2); // 2–3 per wave
    for (const bot of shuffled.slice(0, count)) {
      if (this.current.id !== roundId || this.current.players.has(bot.id)) continue;
      const sol = 0.05 + Math.random() * 1.5;
      await this.enterBot(roundId, bot, BigInt(Math.floor(sol * 1e9)));
    }
  }

  /** One bot entry through the same money-safe debit + entry path as a real player. */
  private async enterBot(
    roundId: string,
    bot: (typeof DEMO_BOTS)[number],
    amount: bigint,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await applyBalanceDelta(tx, bot.id, -amount, {
          reason: 'jackpot_entry',
          refType: 'JackpotRound',
          refId: roundId,
        });
        await tx.jackpotEntry.create({
          data: { roundId, userId: bot.id, amountLamports: amount },
        });
      });
      await this.onEntry({
        roundId,
        userId: bot.id,
        username: bot.username,
        walletAddress: bot.wallet,
        amountLamports: amount,
      });
    } catch (e) {
      this.logger.warn(`jackpot bot ${bot.username} entry skipped: ${String(e)}`);
    }
  }

  private async assumeLeadership(): Promise<void> {
    this.logger.log('jackpot: elected leader — driving rounds');
    await this.bootRounds();
  }

  /** Settle what is due, resume the round that is not, open one only if none is live. */
  private async bootRounds(): Promise<void> {
    this.timers.reset();
    const resumed = await this.recoverStrandedRounds();
    if (!resumed) await this.openNewRound();
  }

  /**
   * A failed loop step (a DB error opening a round, say) used to be an
   * unhandled rejection that could take the whole API process down, or leave
   * the jackpot with no round until a restart. Now it is logged and the boot
   * sequence re-runs after a backoff.
   */
  private guard(step: Promise<unknown>, what: string): void {
    step.catch((e: unknown) => {
      this.logger.error(`jackpot: ${what} failed: ${errMessage(e)} — retrying`);
      this.timers.schedule(() => this.guard(this.bootRounds(), 'boot rounds'), retryDelayMs(2));
    });
  }

  /** A round past its close with nothing settling it gets settled. */
  private startWatchdog(): void {
    if (this.watchdog) return;
    const { watchdogIntervalMs } = roundLoopTuning();
    this.watchdog = setInterval(() => {
      const r = this.current;
      if (!r?.id || r.status !== 'open' || r.closeAt === null) return;
      if (this.settling || this.recovering || !this.isLeader()) return;
      if (Date.now() > r.closeAt + roundLoopTuning().stallMs) {
        this.logger.warn(`jackpot: round ${r.id} overdue — settling now`);
        this.guard(this.drawAndSettle(r.id), 'overdue settle');
      }
    }, watchdogIntervalMs);
    this.watchdog.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.timers.reset();
    if (this.election) await this.election.stop();
  }

  /**
   * Boot recovery. A restart leaves the live round 'open' in the DB; on
   * Cloudflare that is every hourly cron boot and every wake from sleep, and
   * settling it on the spot cut every live round short (entrants never saw the
   * draw — it ran during boot, before any client reconnected). A round whose
   * close has passed is settled (drawn, or refunded below MIN_PLAYERS); the
   * newest round that is still waiting or counting down is resumed. Returns
   * true when a round is live afterwards, so the caller does not open another.
   */
  private async recoverStrandedRounds(): Promise<boolean> {
    let stranded: StoredRound[];
    try {
      stranded = await this.prisma.jackpotRound.findMany({
        where: { status: 'open' },
        select: { id: true, seedId: true, closeAt: true },
        orderBy: { createdAt: 'asc' },
      });
    } catch (e) {
      this.logger.error(`jackpot recovery scan failed: ${errMessage(e)}`);
      return false;
    }
    if (stranded.length === 0) return false;

    const now = Date.now();
    const live =
      [...stranded].reverse().find((r) => r.closeAt === null || r.closeAt.getTime() > now) ?? null;
    const toSettle = stranded.filter((r) => r !== live);
    if (toSettle.length > 0) {
      this.logger.warn(`jackpot recovery: ${toSettle.length} closed round(s) — settling`);
    }

    this.recovering = true;
    try {
      for (const r of toSettle) {
        try {
          this.current = await this.rebuildRound(r);
          if (!(await this.drawAndSettle(r.id, { force: true }))) {
            // Its retry is scheduled and it stays the current round.
            this.logger.error(`jackpot recovery: round ${r.id} did not settle — retrying it first`);
            return true;
          }
          this.logger.log(`jackpot recovery: round ${r.id} settled`);
        } catch (e) {
          // #212 — benign: live draw or a concurrent recovery pass already settled it.
          if (isSettleClaimLost(e)) {
            this.logger.warn(`jackpot recovery skipped round ${r.id}: already settled`);
            continue;
          }
          await this.recordSettlementFailure(r.id, e, { roundId: r.id, path: 'recovery' });
        }
      }
    } finally {
      this.recovering = false;
    }

    if (!live) return false;
    try {
      this.current = await this.rebuildRound(live);
    } catch (e) {
      this.logger.error(`jackpot recovery could not resume round ${live.id}: ${errMessage(e)}`);
      return false;
    }
    this.armCloseTimer();
    this.logger.log(
      `jackpot recovery: resumed round ${live.id} (${this.current.players.size} player(s))`,
    );
    return true;
  }

  /** Rebuild the in-memory round from its row and its entries. */
  private async rebuildRound(r: StoredRound): Promise<CurrentRound> {
    const [seed, entries] = await Promise.all([
      this.prisma.seed.findUniqueOrThrow({ where: { id: r.seedId } }),
      this.prisma.jackpotEntry.findMany({
        where: { roundId: r.id },
        select: { userId: true, amountLamports: true },
      }),
    ]);
    return {
      id: r.id,
      seedId: seed.id,
      serverSeed: seed.serverSeed ?? '',
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
      closeAt: r.closeAt ? r.closeAt.getTime() : null,
      status: 'open',
      totalLamports: entries.reduce((s, e) => s + e.amountLamports, BigInt(0)),
      players: new Set(entries.map((e) => e.userId)),
    };
  }

  /**
   * Schedule the draw at the current round's close. Earlier timers are left to
   * fire: drawAndSettle ignores a timer for another round or one that fires
   * before `closeAt`, so a moved deadline needs no cancellation.
   */
  private armCloseTimer(): void {
    const { id, closeAt } = this.current;
    if (closeAt === null) return;
    this.timers.schedule(() => this.guard(this.drawAndSettle(id), 'draw'), closeAt - Date.now());
  }

  getOpenRound(): { id: string; closeAt: number | null } | null {
    const { status, closeAt } = this.current;
    if (status !== 'open' || (closeAt !== null && Date.now() >= closeAt)) return null;
    return { id: this.current.id, closeAt };
  }

  /**
   * Update live tallies after an entry is persisted, and move the clock: the
   * first entry starts the solo deadline, the MIN_PLAYERS-th distinct player
   * starts the real countdown. On a quiet site the old fixed window from round
   * open meant nearly every round refunded with a single player.
   */
  async onEntry(params: {
    roundId: string;
    userId: string;
    username: string | null;
    walletAddress: string;
    amountLamports: bigint;
  }): Promise<void> {
    // The round already settled (the entry committed just before the claim and
    // was included in it) — nothing live to update.
    if (params.roundId !== this.current.id || this.current.status !== 'open') return;
    const before = this.current.players.size;
    this.current.totalLamports += params.amountLamports;
    this.current.players.add(params.userId);
    const after = this.current.players.size;

    let closeAt = this.current.closeAt;
    if (before === 0 && after >= 1 && after < JACKPOT.MIN_PLAYERS) {
      closeAt = Date.now() + JACKPOT.SOLO_WAIT_MS;
    } else if (before < JACKPOT.MIN_PLAYERS && after >= JACKPOT.MIN_PLAYERS) {
      closeAt = Date.now() + JACKPOT.ROUND_WINDOW_MS;
    }
    const clockMoved = closeAt !== this.current.closeAt;
    this.current.closeAt = closeAt;

    await this.prisma.jackpotRound.update({
      where: { id: this.current.id },
      data: {
        totalLamports: this.current.totalLamports,
        ...(clockMoved && closeAt !== null ? { closeAt: new Date(closeAt) } : {}),
      },
    });
    if (clockMoved) this.armCloseTimer();

    this.gateway.emitEntry({
      roundId: this.current.id,
      playerId: publicPlayerId(params.userId),
      player: displayHandle(params),
      amountLamports: params.amountLamports.toString(),
      totalLamports: this.current.totalLamports.toString(),
      playerCount: after,
      closeAt,
    });
  }

  meta() {
    return {
      roundId: this.current.id,
      status: this.current.status,
      serverSeedHash: this.current.serverSeedHash,
      clientSeed: this.current.clientSeed,
      nonce: this.current.nonce,
      closeAt: this.current.closeAt,
      totalLamports: this.current.totalLamports.toString(),
      playerCount: this.current.players.size,
      config: {
        minEntryLamports: JACKPOT.MIN_ENTRY_LAMPORTS.toString(),
        maxEntryLamports: JACKPOT.MAX_ENTRY_LAMPORTS.toString(),
        houseEdge: JACKPOT.HOUSE_EDGE,
        minPlayers: JACKPOT.MIN_PLAYERS,
        roundWindowMs: JACKPOT.ROUND_WINDOW_MS,
        soloWaitMs: JACKPOT.SOLO_WAIT_MS,
      },
      lastResult: this.lastResult,
    };
  }

  // ---------- Scheduler ----------

  /** Open a round. It waits for players: no clock, no timer, no empty-round churn. */
  private async openNewRound(): Promise<void> {
    if (!this.isLeader()) return; // never open a round as a non-leader
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const nonce = 0;

    const seed = await this.prisma.seed.create({
      data: { serverSeed, serverSeedHash: commitServerSeed(serverSeed), clientSeed, nonce },
    });

    const round = await this.prisma.jackpotRound.create({
      data: { seedId: seed.id, nonce, status: 'open', closeAt: null },
    });

    this.current = {
      id: round.id,
      seedId: seed.id,
      serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed,
      nonce,
      closeAt: null,
      status: 'open',
      totalLamports: BigInt(0),
      players: new Set(),
    };
    this.settleFailures = 0;

    this.gateway.emitRoundOpen({
      roundId: round.id,
      serverSeedHash: seed.serverSeedHash,
      clientSeed,
      nonce,
      closeAt: null,
    });

    // Demo: stagger a couple of bot waves into the window so the round always draws.
    if (this.demoBots) {
      const rid = round.id;
      this.timers.schedule(() => void this.fillBots(rid), 4000);
      this.timers.schedule(() => void this.fillBots(rid), 11000);
    }
  }

  /**
   * Draw (or refund) round `roundId`. Returns true once the round is terminal;
   * false when it was not due or the settle failed (a retry is then scheduled).
   * `force` settles regardless of the clock (recovery of a closed round).
   */
  private async drawAndSettle(
    roundId = this.current.id,
    opts: { force?: boolean } = {},
  ): Promise<boolean> {
    if (!this.isLeader() || this.settling) return false; // only the leader settles, once at a time
    // Snapshot: a stale timer for an older round, or one firing before a moved
    // deadline, must be a no-op — the leftover-timer bug closed the NEXT round early.
    const round = this.current;
    if (round.id !== roundId || round.status !== 'open') return false;
    if (!opts.force && (round.closeAt === null || Date.now() < round.closeAt)) return false;
    this.settling = true;
    try {
      return await this.settleRound(round);
    } finally {
      this.settling = false;
    }
  }

  private async settleRound(round: CurrentRound): Promise<boolean> {
    const roundId = round.id;
    const { serverSeed, clientSeed, nonce, seedId } = round;
    // Every retry has failed: stop trying to draw and give everyone their stake back.
    const forceRefund = this.settleFailures >= roundLoopTuning().settleRetryAttempts;
    if (forceRefund) {
      this.logger.error(`jackpot ${roundId}: draw failed ${this.settleFailures}× — refunding`);
    }

    // ON-CHAIN ANCHORING (shared scadium_rng program): fold the program's entropy
    // into the DRAW seed so the winning ticket derives from the one contract, just
    // like the lottery. Driven BEFORE the serializable settle tx so the ~1s
    // commit→reveal never holds it open. Off-chain — or on ANY failure — `drawSeed`
    // stays === `serverSeed` (deriveSeedContext pass-through), so the winner is
    // byte-identical to the play-money draw. The original `serverSeed` is still
    // revealed for commit verification; `onchainEntropyHex` lets the verifier fold.
    let drawSeed = serverSeed;
    let onchainEntropyHex: string | null = null;
    if (this.onchainRng?.live && !forceRefund) {
      const entropy = await this.onchainRng.roundEntropy({
        gameType: 'jackpot',
        roundId: this.onchainRng.nextRoundId(),
        serverSeed,
        clientSeed,
        nonce,
        gameParams: {},
      });
      if (entropy) {
        drawSeed = deriveSeedContext({
          serverSeed,
          clientSeed,
          nonce,
          onchainEntropy: entropy,
        }).serverSeed;
        onchainEntropyHex = Buffer.from(entropy).toString('hex');
      }
    }

    // #215 — outcome computed INSIDE the serializable tx from an inside-the-tx
    // entry read, so a late enter that commits before our claim is ALWAYS
    // included and one after is ALWAYS rejected (see the closure below). These
    // outer vars carry the in-tx result back out for the gateway/log/chain side
    // effects, which must fire only AFTER the tx commits.
    let total = BigInt(0);
    let distinctCount = 0;
    let didRefund = false;
    let winnerUserId: string | null = null;
    let winnerName: string | null = null;
    let ranges: JackpotRangeRow[] = [];
    let ticket: bigint | null = null as bigint | null;
    let payout = BigInt(0);
    // Pre-generate bet ids + collect on-chain settle jobs as DATA ONLY; the
    // chain calls fire AFTER the tx commits.
    const settleJobs: {
      betId: string;
      userId: string;
      walletAddress: string;
      stake: bigint;
      payout: bigint;
      multiplier: number;
      won: boolean;
    }[] = [];

    // Refund every entry / draw + settle every player + flip the round terminal
    // + reveal the seed in ONE serializable transaction. #215: the entry read is
    // performed INSIDE this tx so it shares the serializable snapshot with the
    // #212 claim. A concurrent enter that commits its entry races our claim on
    // the SAME round row (its guarded `status:'open'` no-op write vs our claim's
    // `open`→terminal flip): if it commits first it is in our snapshot and gets
    // settled; if it would commit after our claim, the conflicting round-row
    // write forces a 40001 the retry re-snapshots, OR its guard sees the round
    // already terminal and rolls the late entry (debit included) back. Either
    // way no entry is ever left orphaned (debited, never settled/refunded).
    try {
      await withSerializable(
        this.prisma,
        async (tx) => {
          // #212 — re-assert leadership AFTER the tx opens (a demoted leader aborts
          // before crediting/refunding).
          assertStillLeader(() => this.isLeader(), 'jackpot');

          // (createdAt, id): the entry order the ranges are laid out in must be
          // total — two entries in the same millisecond need a tiebreak, or the
          // published ranges could not be reproduced.
          const entries = await tx.jackpotEntry.findMany({
            where: { roundId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: { user: { select: { id: true, username: true, walletAddress: true } } },
          });
          const distinctPlayers = new Set(entries.map((e) => e.userId));
          distinctCount = distinctPlayers.size;
          total = entries.reduce((s, e) => s + e.amountLamports, BigInt(0));

          // Not enough distinct players → refund everyone, roll the round over.
          // Also the fallback once a draw has failed every retry (forceRefund).
          if (distinctPlayers.size < JACKPOT.MIN_PLAYERS || forceRefund) {
            didRefund = true;
            // #212 — CLAIM the round: the guarded flip is the concurrency gate.
            // Only the settler that transitions 'open'→'refunded' wins; a
            // resumed-stale leader OR a concurrent recovery pass matches 0 rows and
            // throws, rolling back the whole tx (no double refund).
            const { count } = await tx.jackpotRound.updateMany({
              where: { id: roundId, status: 'open' },
              data: { status: 'refunded', totalLamports: total, drawnAt: new Date() },
            });
            assertRoundClaimed(count, 'jackpot', roundId);
            for (const e of entries) {
              await applyBalanceDelta(tx, e.userId, e.amountLamports, {
                reason: 'jackpot_refund',
                refType: 'JackpotRound',
                refId: roundId,
              });
            }
            await tx.seed.update({ where: { id: seedId }, data: { revealedAt: new Date() } });
            return;
          }

          // Draw the winning ticket and walk cumulative ranges to find the winner.
          // BigInt end-to-end: the pot can exceed 2^53 lamports, so casting to a JS
          // number here would lose precision and bias the winner toward low tickets.
          const drawnTicket = jackpotWinningTicket(drawSeed, clientSeed, nonce, total);
          const walk = jackpotRanges(entries.map((e) => e.amountLamports));
          const winnerIdx = walk.findIndex((r) => drawnTicket >= r.start && drawnTicket < r.end);
          const winner = entries[winnerIdx] ?? entries[0]!;
          ranges = entries.map((e, i) => ({
            playerId: publicPlayerId(e.userId),
            player: displayHandle(e.user),
            amountLamports: e.amountLamports.toString(),
            start: walk[i]!.start.toString(),
            end: walk[i]!.end.toString(),
          }));
          ticket = drawnTicket;
          winnerUserId = winner.userId;
          winnerName = displayHandle(winner.user);
          payout = (total * BigInt(Math.round((1 - JACKPOT.HOUSE_EDGE) * 1000))) / BigInt(1000);

          // Per-user contribution totals for ledger aggregates + Bet rows.
          const byUser = new Map<
            string,
            { amount: bigint; username: string | null; walletAddress: string }
          >();
          for (const e of entries) {
            const cur =
              byUser.get(e.userId) ??
              ({
                amount: BigInt(0),
                username: e.user.username,
                walletAddress: e.user.walletAddress,
              } as { amount: bigint; username: string | null; walletAddress: string });
            cur.amount += e.amountLamports;
            byUser.set(e.userId, cur);
          }

          // #212 — CLAIM the round: the guarded 'open'→'drawn' flip (with the draw
          // result) is the concurrency gate. Only the winning settler proceeds; a
          // resumed-stale leader OR a concurrent recovery pass matches 0 rows and
          // throws, rolling back the whole tx so NO credits/Bet rows commit.
          const { count } = await tx.jackpotRound.updateMany({
            where: { id: roundId, status: 'open' },
            data: {
              status: 'drawn',
              totalLamports: total,
              winnerId: winner.userId,
              winningTicket: drawnTicket,
              payoutLamports: payout,
              drawnAt: new Date(),
              // Persisted with the claim: the public, reproducible ticket map.
              rangesJson: ranges,
            },
          });
          assertRoundClaimed(count, 'jackpot', roundId);

          settleJobs.length = 0;
          for (const [userId, info] of byUser) {
            const won = userId === winner.userId;
            const credited = won ? payout : BigInt(0);
            const profit = credited - info.amount;
            const multiplier = info.amount > BigInt(0) ? Number(credited) / Number(info.amount) : 0;
            const betId = randomUUID();
            settleJobs.push({
              betId,
              userId,
              walletAddress: info.walletAddress,
              stake: info.amount,
              payout: credited,
              multiplier,
              won,
            });

            await tx.user.update({
              where: { id: userId },
              data: {
                totalWagered: { increment: info.amount },
                totalWon: { increment: profit > BigInt(0) ? profit : BigInt(0) },
                totalLost: { increment: profit < BigInt(0) ? -profit : BigInt(0) },
                gamesPlayed: { increment: 1 },
              },
            });
            // biggestWin = max(current, profit) atomically under the row lock (no
            // stale read-then-write). Matches reconcileAll's GREATEST(payout -
            // amount, 0) (Bet amount = info.amount); a loser passes net ≤ 0 → no
            // change.
            await tx.$executeRaw`
              UPDATE "User" SET "biggestWin" = GREATEST("biggestWin", ${profit})
              WHERE "id" = ${userId}::uuid
            `;
            await this.proofOfWager.accrue(tx, {
              userId,
              gameType: 'jackpot',
              stakeLamports: info.amount,
            });
            // Affiliate commission on this entry's wager, in-tx (#47 coverage).
            await this.affiliates.creditReferral(tx, userId, info.amount, 'jackpot');
            // Credit the play balance through the single mutation point (ledger
            // row in this tx). Only the winner is credited; losers move nothing.
            if (credited > BigInt(0)) {
              await applyBalanceDelta(tx, userId, credited, {
                reason: 'jackpot_settle',
                refType: 'Bet',
                refId: betId,
              });
            }
            await tx.bet.create({
              data: {
                id: betId,
                userId,
                gameType: 'jackpot',
                amountLamports: info.amount,
                payoutLamports: credited,
                multiplier,
                status: won ? 'won' : 'lost',
                seedId,
                nonce,
                resultJson: {
                  totalLamports: total.toString(),
                  winningTicket: drawnTicket.toString(),
                  won,
                  // This player's own slice — check the ticket against it.
                  range: ranges.find((r) => r.playerId === publicPlayerId(userId)) ?? null,
                  // Self-contained verification context (ADR 0001 / #93). When the
                  // draw was on-chain anchored, `onchainEntropy` is the program's
                  // RoundSettled.entropy — fold it into serverSeed to reproduce.
                  fair: {
                    serverSeed: round.serverSeed,
                    serverSeedHash: round.serverSeedHash,
                    clientSeed: round.clientSeed,
                    nonce: round.nonce,
                    ...(onchainEntropyHex ? { onchainEntropy: onchainEntropyHex } : {}),
                  },
                },
              },
            });
          }
          // Round terminal flip (+ draw result) happened at claim time above; only
          // the seed reveal remains.
          await tx.seed.update({ where: { id: seedId }, data: { revealedAt: new Date() } });
        },
        undefined,
        settleTxOptions(),
      );
    } catch (e) {
      // #212 — benign: peer already settled this round (no dead-letter, no new round).
      if (isSettleClaimLost(e)) {
        this.logger.warn(`jackpot settle skipped: ${errMessage(e)}`);
        return true;
      }
      this.settleFailures += 1;
      // One dead-letter per round (its first failure); later attempts only log.
      if (this.settleFailures === 1) {
        await this.recordSettlementFailure(roundId, e, {
          roundId,
          path: didRefund ? 'refund' : 'draw',
          total: total.toString(),
          winnerId: winnerUserId,
          winningTicket: ticket?.toString() ?? null,
          payout: payout.toString(),
        });
      } else {
        this.logger.error(
          `Jackpot settle failed for ${roundId} (attempt ${this.settleFailures}): ${errMessage(e)}`,
        );
      }
      // The round stays 'open' in the DB (entries closed: getOpenRound() is past
      // closeAt) and is retried with backoff, falling back to a refund once the
      // draw has failed every attempt. It used to stop the game until a restart.
      this.timers.schedule(
        () => this.guard(this.drawAndSettle(roundId, { force: true }), 'settle retry'),
        retryDelayMs(this.settleFailures),
      );
      return false;
    }
    this.settleFailures = 0;

    if (didRefund) {
      round.status = 'refunded';
      this.setLastResult(round, {
        roundId,
        status: 'refunded',
        winnerName: null,
        payout: BigInt(0),
        total,
        ticket: null,
      });
      this.gateway.emitDrawResult({
        roundId,
        status: 'refunded',
        winnerPlayerId: null,
        winnerName: null,
        payoutLamports: '0',
        totalLamports: total.toString(),
        winningTicket: null,
        serverSeed,
        ranges: [],
      });
      this.logger.log(`Jackpot ${roundId} refunded (${distinctCount} players)`);
      if (!this.recovering) await this.openNewRound();
      return true;
    }

    round.status = 'drawn';

    // Post-commit, fire-and-forget: surface every entry's settle on the feed.
    for (const job of settleJobs) {
      this.liveFeed?.publishSettledBet({
        userId: job.userId,
        betId: job.betId,
        gameType: 'jackpot',
        amountLamports: job.stake,
        payoutLamports: job.payout,
        multiplier: job.won && job.stake > BigInt(0) ? job.multiplier : null,
        won: job.won,
      });
    }

    // On-chain settlement receipts AFTER the bet rows commit (fire-and-forget,
    // no-op when disabled — never blocks the round loop).
    if (this.chain.enabled) {
      for (const job of settleJobs) {
        void this.chain
          .recordBet({
            betId: job.betId,
            walletAddress: job.walletAddress,
            game: 'jackpot',
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
            this.logger.error(`on-chain record failed for ${job.betId}: ${String(e)}`),
          );
      }
    }

    this.setLastResult(round, { roundId, status: 'drawn', winnerName, payout, total, ticket });
    this.gateway.emitDrawResult({
      roundId,
      status: 'drawn',
      winnerPlayerId: winnerUserId ? publicPlayerId(winnerUserId) : null,
      winnerName,
      payoutLamports: payout.toString(),
      totalLamports: total.toString(),
      winningTicket: ticket === null ? null : String(ticket),
      serverSeed,
      // The reveal lands on the real ticket in the real entry order — the old
      // reel used a client-side list that could miss a last-second entrant and
      // tell the biggest staker "You won".
      ranges,
    });
    this.logger.log(
      `Jackpot ${roundId} → winner ${winnerName ?? winnerUserId} takes ${payout} of ${total}`,
    );
    if (!this.recovering) await this.openNewRound();
    return true;
  }

  /**
   * Best-effort dead-letter write when a settlement fails. Must never throw — a
   * logging failure can't be allowed to crash the round loop.
   */
  private async recordSettlementFailure(
    roundId: string,
    error: unknown,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const message = errMessage(error);
    this.logger.error(`Jackpot settle failed for ${roundId}: ${message}`);
    try {
      settlementsTotal.inc({ game: 'jackpot', outcome: 'failed' });
      await this.prisma.settlementFailure.create({
        data: {
          gameType: 'jackpot',
          roundId,
          payloadJson: payload as object,
          error: message,
        },
      });
    } catch (e) {
      this.logger.error(`Failed to write SettlementFailure for jackpot ${roundId}: ${String(e)}`);
    }
  }

  private setLastResult(
    round: CurrentRound,
    p: {
      roundId: string;
      status: 'drawn' | 'refunded';
      winnerName: string | null;
      payout: bigint;
      total: bigint;
      ticket: bigint | null;
    },
  ): void {
    this.lastResult = {
      roundId: p.roundId,
      status: p.status,
      winnerName: p.winnerName,
      payoutLamports: p.payout.toString(),
      totalLamports: p.total.toString(),
      winningTicket: p.ticket === null ? null : String(p.ticket),
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      drawnAt: Date.now(),
    };
  }
}
