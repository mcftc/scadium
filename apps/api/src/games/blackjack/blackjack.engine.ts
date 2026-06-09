import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  blackjackDeal,
  handValue,
  isBlackjack,
  isBust,
  evaluate21Plus3,
  evaluatePerfectPairs,
  generateServerSeed,
  generateClientSeed,
  commitServerSeed,
  type TwentyOnePlusThreeOutcome,
  type PerfectPairsOutcome,
} from '@scadium/fair';
import { BLACKJACK, SCAD, type Card } from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { withSerializable } from '../../prisma/with-serializable';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';
import { ChainService } from '../../solana/chain.service';
import { BlackjackGateway } from './blackjack.gateway';

type Phase = 'idle' | 'betting' | 'dealing' | 'player_turns' | 'dealer_turn' | 'settled';
type HandStatus = 'playing' | 'standing' | 'busted' | 'blackjack';
type SeatResult = 'win' | 'lose' | 'push' | 'blackjack' | null;

interface SeatBet {
  mainLamports: bigint;
  side21p3Lamports: bigint;
  sidePerfectPairsLamports: bigint;
}

interface Seat {
  index: number;
  userId: string;
  username: string | null;
  walletAddress: string;
  /** Consecutive rounds without a bet — 3 frees the seat. */
  idleRounds: number;
  bet: SeatBet | null;
  cards: Card[];
  status: HandStatus;
  doubled: boolean;
  side21p3Outcome: TwentyOnePlusThreeOutcome | null;
  sidePerfectPairsOutcome: PerfectPairsOutcome | null;
  result: SeatResult;
  payoutLamports: bigint;
}

interface TableState {
  id: string;
  name: string;
  isPrivate: boolean;
  /** Owner of a private (Play Alone) table. */
  ownerId: string | null;
  maxSeats: number;
  phase: Phase;
  /** Deadline of the current timed phase (betting window / seat turn). */
  closeAt: number | null;
  /** Seat index whose turn it is during player_turns. */
  activeSeat: number | null;
  seats: Map<number, Seat>;
  dealerCards: Card[];
  dealerHidden: boolean;
  deckIndex: number;
  roundDbId: string | null;
  seedId: string | null;
  serverSeed: string | null;
  serverSeedHash: string | null;
  clientSeed: string | null;
  nonce: number;
  timer: NodeJS.Timeout | null;
  /** Private tables self-destruct after 10 idle minutes. */
  lastActivityAt: number;
}

/**
 * Multiplayer blackjack table engine (solpump model). Each table runs an
 * independent phase machine: idle → PLACE YOUR BETS (15s) → dealing →
 * seat-by-seat player turns (15s each, timeout = stand) → dealer auto-play
 * (cards revealed one by one) → settle → next round.
 *
 * Provably fair: one fresh committed seed per round; every card is drawn
 * from the deterministic HMAC stream at a public, monotonically increasing
 * deck index (first pass seats then dealer up-card, second pass seats then
 * the hole card, hits in action order). Side bets (21+3, Perfect Pairs) are
 * pure functions of the dealt cards — same seed verifies everything.
 */
@Injectable()
export class BlackjackEngine implements OnModuleInit {
  private readonly logger = new Logger(BlackjackEngine.name);
  private readonly tables = new Map<string, TableState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: BlackjackGateway,
    private readonly chain: ChainService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.createTable('Main Table', false, null);
    // Sweep idle private tables every minute.
    setInterval(() => this.sweepPrivateTables(), 60_000).unref();
  }

  // ---------- Table management ----------

  private async createTable(
    name: string,
    isPrivate: boolean,
    ownerId: string | null,
  ): Promise<TableState> {
    const row = await this.prisma.blackjackTable.create({
      data: {
        name,
        status: 'waiting',
        minBetLamports: BigInt(BLACKJACK.MIN_BET_LAMPORTS),
        maxBetLamports: BigInt(BLACKJACK.MAX_BET_LAMPORTS),
        maxSeats: isPrivate ? 1 : BLACKJACK.MAX_SEATS,
      },
    });
    const table: TableState = {
      id: row.id,
      name,
      isPrivate,
      ownerId,
      maxSeats: isPrivate ? 1 : BLACKJACK.MAX_SEATS,
      phase: 'idle',
      closeAt: null,
      activeSeat: null,
      seats: new Map(),
      dealerCards: [],
      dealerHidden: true,
      deckIndex: 0,
      roundDbId: null,
      seedId: null,
      serverSeed: null,
      serverSeedHash: null,
      clientSeed: null,
      nonce: 0,
      timer: null,
      lastActivityAt: Date.now(),
    };
    this.tables.set(table.id, table);
    return table;
  }

  /** Seated players across public tables — header "Games" dropdown counter. */
  seatedCount(): number {
    let n = 0;
    for (const t of this.tables.values()) if (!t.isPrivate) n += t.seats.size;
    return n;
  }

  /** Public lobby list (private tables hidden). */
  listTables() {
    return [...this.tables.values()]
      .filter((t) => !t.isPrivate)
      .map((t) => ({
        id: t.id,
        name: t.name,
        phase: t.phase,
        seatedCount: t.seats.size,
        maxSeats: t.maxSeats,
      }));
  }

  /** "Find New Lobby": the public table with the most free seats; new one if all full. */
  async findLobby(): Promise<{ tableId: string }> {
    const open = [...this.tables.values()]
      .filter((t) => !t.isPrivate && t.seats.size < t.maxSeats)
      .sort((a, b) => a.seats.size - b.seats.size)[0];
    if (open) return { tableId: open.id };
    const created = await this.createTable(`Table ${this.tables.size + 1}`, false, null);
    return { tableId: created.id };
  }

  /** "Play Alone": a single-seat private table owned by the caller. */
  async soloTable(userId: string): Promise<{ tableId: string }> {
    for (const t of this.tables.values()) {
      if (t.isPrivate && t.ownerId === userId) return { tableId: t.id };
    }
    const created = await this.createTable('Private Table', true, userId);
    return { tableId: created.id };
  }

  private sweepPrivateTables() {
    const cutoff = Date.now() - 10 * 60_000;
    for (const t of this.tables.values()) {
      if (t.isPrivate && t.seats.size === 0 && t.phase === 'idle' && t.lastActivityAt < cutoff) {
        if (t.timer) clearTimeout(t.timer);
        this.tables.delete(t.id);
      }
    }
  }

  private table(tableId: string): TableState {
    const t = this.tables.get(tableId);
    if (!t) throw new Error('Table not found');
    return t;
  }

  // ---------- Snapshot ----------

  snapshot(tableId: string) {
    const t = this.table(tableId);
    const dealerValue =
      t.dealerCards.length > 0
        ? t.dealerHidden
          ? handValue(t.dealerCards.slice(0, 1)).total
          : handValue(t.dealerCards).total
        : null;
    return {
      id: t.id,
      name: t.name,
      isPrivate: t.isPrivate,
      phase: t.phase,
      closeAt: t.closeAt,
      activeSeat: t.activeSeat,
      maxSeats: t.maxSeats,
      seats: [...t.seats.values()].map((s) => ({
        index: s.index,
        userId: s.userId,
        username: s.username,
        walletAddress: s.walletAddress,
        bet: s.bet
          ? {
              mainLamports: s.bet.mainLamports.toString(),
              side21p3Lamports: s.bet.side21p3Lamports.toString(),
              sidePerfectPairsLamports: s.bet.sidePerfectPairsLamports.toString(),
            }
          : null,
        cards: s.cards,
        total: s.cards.length > 0 ? handValue(s.cards).total : null,
        status: s.status,
        doubled: s.doubled,
        side21p3Outcome: s.side21p3Outcome,
        sidePerfectPairsOutcome: s.sidePerfectPairsOutcome,
        result: s.result,
        payoutLamports: s.payoutLamports.toString(),
      })),
      // Hole card masked while hidden.
      dealerCards: t.dealerHidden
        ? t.dealerCards.map((c, i) => (i === 1 ? null : c))
        : t.dealerCards,
      dealerTotal: dealerValue,
      serverSeedHash: t.serverSeedHash,
      serverSeed: t.phase === 'settled' || t.phase === 'idle' ? t.serverSeed : null,
      clientSeed: t.clientSeed,
      nonce: t.nonce,
      config: {
        minBetLamports: String(BLACKJACK.MIN_BET_LAMPORTS),
        maxBetLamports: String(BLACKJACK.MAX_BET_LAMPORTS),
        bettingWindowMs: BLACKJACK.BETTING_WINDOW_MS,
        turnTimeoutMs: BLACKJACK.TURN_TIMEOUT_MS,
        sideBets: BLACKJACK.SIDE_BETS,
      },
    };
  }

  private broadcast(t: TableState) {
    this.gateway.emitTable(t.id, this.snapshot(t.id));
  }

  // ---------- Seats ----------

  takeSeat(params: {
    tableId: string;
    seatIndex: number;
    userId: string;
    username: string | null;
    walletAddress: string;
  }) {
    const t = this.table(params.tableId);
    if (params.seatIndex < 0 || params.seatIndex >= t.maxSeats) throw new Error('Invalid seat');
    if (t.isPrivate && t.ownerId !== params.userId) throw new Error('Private table');
    if (t.seats.has(params.seatIndex)) throw new Error('Seat taken');
    for (const s of t.seats.values()) {
      if (s.userId === params.userId) throw new Error('You are already seated at this table');
    }
    t.seats.set(params.seatIndex, {
      index: params.seatIndex,
      userId: params.userId,
      username: params.username,
      walletAddress: params.walletAddress,
      idleRounds: 0,
      bet: null,
      cards: [],
      status: 'playing',
      doubled: false,
      side21p3Outcome: null,
      sidePerfectPairsOutcome: null,
      result: null,
      payoutLamports: BigInt(0),
    });
    t.lastActivityAt = Date.now();
    this.broadcast(t);
    return { ok: true as const };
  }

  /** Leave the table; returns any refundable bet (only during betting). */
  leaveSeat(tableId: string, userId: string): { refundLamports: bigint } {
    const t = this.table(tableId);
    const seat = [...t.seats.values()].find((s) => s.userId === userId);
    if (!seat) throw new Error('Not seated');
    let refund = BigInt(0);
    if (seat.bet) {
      if (t.phase === 'betting') {
        refund = this.betTotal(seat.bet);
      } else if (t.phase !== 'idle' && t.phase !== 'settled') {
        throw new Error('Hand in progress — finish the round first');
      }
    }
    t.seats.delete(seat.index);
    t.lastActivityAt = Date.now();
    this.broadcast(t);
    return { refundLamports: refund };
  }

  private betTotal(b: SeatBet): bigint {
    return b.mainLamports + b.side21p3Lamports + b.sidePerfectPairsLamports;
  }

  // ---------- Betting ----------

  /**
   * Place (or replace) the seat's bet for the upcoming round. The service
   * has already debited `betTotal`; replacing returns the previous total for
   * refund. Placing the first bet of a round starts the betting countdown.
   */
  placeBet(params: {
    tableId: string;
    userId: string;
    bet: SeatBet;
  }): { previousTotalLamports: bigint } {
    const t = this.table(params.tableId);
    if (t.phase !== 'idle' && t.phase !== 'betting' && t.phase !== 'settled') {
      throw new Error('Bets are closed — wait for the next round');
    }
    const seat = [...t.seats.values()].find((s) => s.userId === params.userId);
    if (!seat) throw new Error('Take a seat first');

    const prev = seat.bet ? this.betTotal(seat.bet) : BigInt(0);
    seat.bet = params.bet;
    seat.idleRounds = 0;
    t.lastActivityAt = Date.now();

    // First bet while idle/settled kicks off the betting window.
    if (t.phase === 'idle' || t.phase === 'settled') {
      void this.openBetting(t);
    } else {
      this.broadcast(t);
    }
    return { previousTotalLamports: prev };
  }

  /** Clear the seat's bet during the betting window; returns the refund. */
  clearBet(tableId: string, userId: string): { refundLamports: bigint } {
    const t = this.table(tableId);
    if (t.phase !== 'betting') throw new Error('No open betting window');
    const seat = [...t.seats.values()].find((s) => s.userId === userId);
    if (!seat?.bet) throw new Error('No bet to clear');
    const refund = this.betTotal(seat.bet);
    seat.bet = null;
    this.broadcast(t);
    return { refundLamports: refund };
  }

  // ---------- Round lifecycle ----------

  private async openBetting(t: TableState): Promise<void> {
    // Synchronous prologue BEFORE any await: kill the settle-pause timer and
    // flip the phase so it can no longer wipe freshly-placed bets (the timer
    // callback guards on phase === 'settled').
    if (t.timer) {
      clearTimeout(t.timer);
      t.timer = null;
    }
    t.phase = 'betting';
    t.closeAt = null;

    // Fresh committed seed per round.
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const seed = await this.prisma.seed.create({
      data: { serverSeed, serverSeedHash: commitServerSeed(serverSeed), clientSeed, nonce: 0 },
    });
    const round = await this.prisma.blackjackRound.create({
      data: { tableId: t.id, seedId: seed.id, nonce: 0, stateJson: {} },
    });

    // Reset per-round seat state (seats persist across rounds).
    for (const s of t.seats.values()) {
      s.cards = [];
      s.status = 'playing';
      s.doubled = false;
      s.side21p3Outcome = null;
      s.sidePerfectPairsOutcome = null;
      s.result = null;
      s.payoutLamports = BigInt(0);
    }

    t.closeAt = Date.now() + BLACKJACK.BETTING_WINDOW_MS;
    t.activeSeat = null;
    t.dealerCards = [];
    t.dealerHidden = true;
    t.deckIndex = 0;
    t.roundDbId = round.id;
    t.seedId = seed.id;
    t.serverSeed = serverSeed;
    t.serverSeedHash = seed.serverSeedHash;
    t.clientSeed = clientSeed;
    t.nonce = 0;

    await this.prisma.blackjackTable.update({ where: { id: t.id }, data: { status: 'betting' } });
    this.broadcast(t);

    if (t.timer) clearTimeout(t.timer);
    t.timer = setTimeout(() => void this.deal(t), BLACKJACK.BETTING_WINDOW_MS);
  }

  private drawCard(t: TableState): Card {
    const card = blackjackDeal(t.serverSeed!, t.clientSeed!, t.nonce, t.deckIndex + 1)[
      t.deckIndex
    ]!;
    t.deckIndex += 1;
    return card;
  }

  private bettingSeats(t: TableState): Seat[] {
    return [...t.seats.values()].filter((s) => s.bet !== null).sort((a, b) => a.index - b.index);
  }

  private async deal(t: TableState): Promise<void> {
    const players = this.bettingSeats(t);

    // Track sit-outs; free seats that idled too long.
    for (const s of [...t.seats.values()]) {
      if (!s.bet) {
        s.idleRounds += 1;
        if (s.idleRounds >= BLACKJACK.IDLE_ROUNDS_TO_UNSEAT) t.seats.delete(s.index);
      }
    }

    if (players.length === 0) {
      t.phase = 'idle';
      t.closeAt = null;
      await this.prisma.blackjackTable.update({ where: { id: t.id }, data: { status: 'waiting' } });
      this.broadcast(t);
      return;
    }

    t.phase = 'dealing';
    t.closeAt = null;
    this.broadcast(t);

    // Deal order (public, deterministic): pass 1 — each betting seat, then
    // the dealer's up-card; pass 2 — each seat again, then the hole card.
    const dealSequence: { seatIndex: number | 'dealer'; hidden: boolean }[] = [];
    for (const s of players) dealSequence.push({ seatIndex: s.index, hidden: false });
    dealSequence.push({ seatIndex: 'dealer', hidden: false });
    for (const s of players) dealSequence.push({ seatIndex: s.index, hidden: false });
    dealSequence.push({ seatIndex: 'dealer', hidden: true });

    for (const step of dealSequence) {
      const card = this.drawCard(t);
      if (step.seatIndex === 'dealer') {
        t.dealerCards.push(card);
      } else {
        t.seats.get(step.seatIndex)!.cards.push(card);
      }
      // Staggered card events drive the client deal animation.
      this.gateway.emitCard(t.id, {
        seatIndex: step.seatIndex,
        card: step.hidden ? null : card,
        hidden: step.hidden,
      });
      await sleep(250);
    }

    // Side bets resolve off the dealt cards (player pair + dealer up-card).
    const dealerUp = t.dealerCards[0]!;
    for (const s of players) {
      if (s.bet!.side21p3Lamports > BigInt(0)) {
        s.side21p3Outcome = evaluate21Plus3(s.cards[0]!, s.cards[1]!, dealerUp);
      }
      if (s.bet!.sidePerfectPairsLamports > BigInt(0)) {
        s.sidePerfectPairsOutcome = evaluatePerfectPairs(s.cards[0]!, s.cards[1]!);
      }
      if (isBlackjack(s.cards)) s.status = 'blackjack';
    }

    await this.prisma.blackjackTable.update({
      where: { id: t.id },
      data: { status: 'player_turns' },
    });
    this.startPlayerTurns(t);
  }

  private startPlayerTurns(t: TableState) {
    t.phase = 'player_turns';
    this.advanceTurn(t, -1);
  }

  /** Move to the first actionable seat after `fromIndex`; dealer when none. */
  private advanceTurn(t: TableState, fromIndex: number) {
    const players = this.bettingSeats(t);
    const next = players.find((s) => s.index > fromIndex && s.status === 'playing');
    if (!next) {
      void this.dealerTurn(t);
      return;
    }
    t.activeSeat = next.index;
    t.closeAt = Date.now() + BLACKJACK.TURN_TIMEOUT_MS;
    this.broadcast(t);
    this.gateway.emitTurn(t.id, { seatIndex: next.index, deadline: t.closeAt });

    if (t.timer) clearTimeout(t.timer);
    const expectSeat = next.index;
    t.timer = setTimeout(() => {
      // Timeout: auto-stand whoever is still on the clock.
      if (t.phase === 'player_turns' && t.activeSeat === expectSeat) {
        const seat = t.seats.get(expectSeat);
        if (seat && seat.status === 'playing') {
          seat.status = 'standing';
          this.advanceTurn(t, expectSeat);
        }
      }
    }, BLACKJACK.TURN_TIMEOUT_MS);
  }

  /**
   * Seat action (hit/stand/double) for the user whose turn it is. `double`
   * needs the extra stake debited by the service BEFORE calling in.
   */
  action(params: { tableId: string; userId: string; action: 'hit' | 'stand' | 'double' }) {
    const t = this.table(params.tableId);
    if (t.phase !== 'player_turns' || t.activeSeat === null) throw new Error('Not your turn');
    const seat = t.seats.get(t.activeSeat);
    if (!seat || seat.userId !== params.userId) throw new Error('Not your turn');
    if (seat.status !== 'playing') throw new Error('Hand already finished');

    if (params.action === 'double' && seat.cards.length !== 2) {
      throw new Error('Double only on the first two cards');
    }

    if (params.action === 'hit' || params.action === 'double') {
      const card = this.drawCard(t);
      seat.cards.push(card);
      this.gateway.emitCard(t.id, { seatIndex: seat.index, card, hidden: false });
      if (params.action === 'double') {
        seat.doubled = true;
        seat.bet!.mainLamports *= BigInt(2);
      }
      if (isBust(seat.cards)) seat.status = 'busted';
      else if (params.action === 'double') seat.status = 'standing';
      else if (handValue(seat.cards).total === 21) seat.status = 'standing';
    } else {
      seat.status = 'standing';
    }

    t.lastActivityAt = Date.now();
    if (seat.status === 'playing') {
      // Same seat keeps the turn (after a hit below 21) — reset the clock.
      this.advanceTurn(t, seat.index - 1);
    } else {
      this.advanceTurn(t, seat.index);
    }
    return { ok: true as const };
  }

  private async dealerTurn(t: TableState): Promise<void> {
    if (t.timer) clearTimeout(t.timer);
    t.phase = 'dealer_turn';
    t.activeSeat = null;
    t.closeAt = null;
    await this.prisma.blackjackTable.update({ where: { id: t.id }, data: { status: 'dealer_turn' } });

    // Reveal the hole card first — even when everyone busted (UI integrity).
    t.dealerHidden = false;
    this.gateway.emitCard(t.id, { seatIndex: 'dealer', card: t.dealerCards[1]!, hidden: false });
    this.broadcast(t);
    await sleep(600);

    // Dealer draws only if someone can still win against the house.
    const players = this.bettingSeats(t);
    const anyLive = players.some((s) => s.status === 'standing' || s.status === 'blackjack');
    if (anyLive) {
      let v = handValue(t.dealerCards);
      while (v.total < 17 || (v.total === 17 && v.soft && BLACKJACK.DEALER_HITS_SOFT_17)) {
        const card = this.drawCard(t);
        t.dealerCards.push(card);
        this.gateway.emitCard(t.id, { seatIndex: 'dealer', card, hidden: false });
        this.broadcast(t);
        await sleep(600);
        v = handValue(t.dealerCards);
      }
    }

    await this.settle(t);
  }

  private async settle(t: TableState): Promise<void> {
    const players = this.bettingSeats(t);
    const dealerBJ = isBlackjack(t.dealerCards);
    const dealerBust = isBust(t.dealerCards);
    const dealerTotal = handValue(t.dealerCards).total;

    // Phase 1 (pure, in-memory): compute each seat's result + payout. These
    // mutations determine the money moved and feed the persisted round state,
    // so they happen before the transaction. Collect per-seat ledger data +
    // on-chain settle jobs (DATA ONLY — chain fires after commit).
    const seatData: {
      seat: Seat;
      betId: string;
      stake: bigint;
      payout: bigint;
      multiplier: number;
      won: boolean;
    }[] = [];
    for (const s of players) {
      const bet = s.bet!;
      // Main hand.
      let mainPayout = BigInt(0);
      if (s.status === 'blackjack') {
        if (dealerBJ) {
          s.result = 'push';
          mainPayout = bet.mainLamports;
        } else {
          s.result = 'blackjack';
          mainPayout = (bet.mainLamports * BigInt(5)) / BigInt(2); // 3:2
        }
      } else if (s.status === 'busted') {
        s.result = 'lose';
      } else {
        const total = handValue(s.cards).total;
        if (dealerBJ) s.result = 'lose';
        else if (dealerBust || total > dealerTotal) {
          s.result = 'win';
          mainPayout = bet.mainLamports * BigInt(2);
        } else if (total === dealerTotal) {
          s.result = 'push';
          mainPayout = bet.mainLamports;
        } else {
          s.result = 'lose';
        }
      }

      // Side bets (already evaluated at deal time).
      let sidePayout = BigInt(0);
      if (s.side21p3Outcome && s.side21p3Outcome !== 'none') {
        sidePayout +=
          bet.side21p3Lamports *
          BigInt(BLACKJACK.SIDE_BETS.twentyOnePlusThree[s.side21p3Outcome]);
      }
      if (s.sidePerfectPairsOutcome && s.sidePerfectPairsOutcome !== 'none') {
        sidePayout +=
          bet.sidePerfectPairsLamports *
          BigInt(BLACKJACK.SIDE_BETS.perfectPairs[s.sidePerfectPairsOutcome]);
      }

      const payout = mainPayout + sidePayout;
      s.payoutLamports = payout;
      const stake = this.betTotal(bet);
      const won = payout > stake;
      seatData.push({
        seat: s,
        betId: randomUUID(),
        stake,
        payout,
        multiplier: stake > BigInt(0) ? Number(payout) / Number(stake) : 0,
        won,
      });
    }

    // Flip the in-memory phase to 'settled' BEFORE building the snapshot so the
    // persisted stateJson reveals the serverSeed (snapshot gates on phase). On
    // a settlement failure we roll this back to 'dealer_turn' below.
    t.phase = 'settled';
    const roundStateJson = this.snapshot(t.id) as object;

    // Phase 2: persist every seat (ledger update + Bet row) + the seed reveal +
    // the round state + the table 'waiting' flip in ONE serializable tx.
    try {
      await withSerializable(this.prisma, async (tx) => {
        for (const d of seatData) {
          const s = d.seat;
          const netProfit = d.payout - d.stake;
          await tx.user.update({
            where: { id: s.userId },
            data: {
              scadiumBalance: { increment: d.stake * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT) },
              totalWagered: { increment: d.stake },
              totalWon: { increment: netProfit > BigInt(0) ? netProfit : BigInt(0) },
              totalLost: { increment: netProfit < BigInt(0) ? -netProfit : BigInt(0) },
              gamesPlayed: { increment: 1 },
            },
          });
          // Credit the play balance through the single mutation point (ledger
          // row in this tx). Skip a pure loss (payout 0) — no balance movement.
          if (d.payout > BigInt(0)) {
            await applyBalanceDelta(tx, s.userId, d.payout, {
              reason: 'blackjack_settle',
              refType: 'Bet',
              refId: d.betId,
            });
          }
          await tx.bet.create({
            data: {
              id: d.betId,
              userId: s.userId,
              gameType: 'blackjack',
              amountLamports: d.stake,
              payoutLamports: d.payout,
              multiplier: d.multiplier,
              status:
                d.won ? 'won' : d.payout === d.stake && d.stake > BigInt(0) ? 'won' : 'lost',
              seedId: t.seedId!,
              nonce: t.nonce,
              resultJson: {
                tableId: t.id,
                seatIndex: s.index,
                result: s.result,
                playerCards: s.cards as unknown as object,
                dealerCards: t.dealerCards as unknown as object,
                doubled: s.doubled,
                side21p3: s.side21p3Outcome,
                sidePerfectPairs: s.sidePerfectPairsOutcome,
              },
            },
          });
        }

        await tx.seed.update({ where: { id: t.seedId! }, data: { revealedAt: new Date() } });
        await tx.blackjackRound.update({
          where: { id: t.roundDbId! },
          data: { stateJson: roundStateJson, endedAt: new Date() },
        });
        await tx.blackjackTable.update({ where: { id: t.id }, data: { status: 'waiting' } });
      });
    } catch (e) {
      // Roll the in-memory phase back so the table is not left terminal, and
      // dead-letter the failure. Do NOT start the settle-pause/idle timer —
      // the round stays non-terminal for the recovery worker.
      t.phase = 'dealer_turn';
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`blackjack settle failed for table ${t.id} after retries: ${message}`);
      try {
        await this.prisma.settlementFailure.create({
          data: {
            gameType: 'blackjack',
            roundId: t.roundDbId ?? t.id,
            payloadJson: {
              tableId: t.id,
              roundDbId: t.roundDbId,
              seats: seatData.map((d) => ({
                userId: d.seat.userId,
                seatIndex: d.seat.index,
                stake: d.stake.toString(),
                payout: d.payout.toString(),
                result: d.seat.result,
              })),
            },
            error: message,
          },
        });
      } catch (deadLetterErr) {
        this.logger.error(
          `Failed to write SettlementFailure for blackjack table ${t.id}: ${String(deadLetterErr)}`,
        );
      }
      return;
    }

    // On-chain settlement receipts AFTER the ledger tx commits (fire-and-forget,
    // no-op when disabled).
    if (this.chain.enabled) {
      for (const d of seatData) {
        void this.chain
          .settleBet({
            betId: d.betId,
            walletAddress: d.seat.walletAddress,
            game: 'blackjack',
            stakeLamports: d.stake,
            payoutLamports: d.payout,
            multiplier: d.multiplier,
          })
          .then(async (sig) => {
            if (sig) {
              await this.prisma.bet.update({ where: { id: d.betId }, data: { txSignature: sig } });
            }
          })
          .catch((e: unknown) => this.logger.error(`bj settle receipt failed: ${String(e)}`));
      }
    }

    this.broadcast(t);
    this.gateway.emitResults(
      t.id,
      players.map((s) => ({
        seatIndex: s.index,
        result: s.result,
        payoutLamports: s.payoutLamports.toString(),
      })),
    );

    // Pause on the result, then go idle: bets are per-round, so the next
    // window starts clean. Guard on phase — a bet placed during the pause
    // already flipped us into 'betting' (openBetting prologue) and this
    // timer must not wipe it.
    if (t.timer) clearTimeout(t.timer);
    t.timer = setTimeout(() => {
      if (t.phase !== 'settled') return;
      for (const s of t.seats.values()) s.bet = null;
      t.phase = 'idle';
      t.closeAt = null;
      this.broadcast(t);
    }, BLACKJACK.SETTLE_PAUSE_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
