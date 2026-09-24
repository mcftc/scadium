import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  generateServerSeed,
  commitServerSeed,
  coinflipResult,
  deriveSeedContext,
} from '@scadium/fair';
import { OnchainRngService } from '../../solana/onchain-rng.service';
import { COINFLIP } from '@scadium/shared';
import { ProofOfWagerService } from '../../proof-of-wager/proof-of-wager.service';
import { randomUUID } from 'node:crypto';
import { ChainService } from '../../solana/chain.service';
import { SeedManagerService } from '../../fairness/seed-manager.service';
import { RgService } from '../../responsible-gambling/rg.service';
import { AffiliatesService } from '../../affiliates/affiliates.service';
import { CoinflipGateway } from './coinflip.gateway';
import { LiveFeedService } from '../../live/live-feed.service';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';
import { claimIdempotency, storeIdempotency } from '../../prisma/idempotency';
import { cancelOpenFlip } from './cancel-open-flip';
import { assertSameEconomy } from '../../custody/economy';

type Side = 'heads' | 'tails';

/** Who takes the other side of a flip. */
type Opponent =
  | {
      kind: 'player';
      userId: string;
      /** Joiner seed reserved before the tx (on-chain RNG mode), else consumed in it. */
      reserved: SeedContext | null;
      onchainEntropy: Uint8Array | null;
    }
  | { kind: 'house' };

interface SeedContext {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: bigint;
}

/** One human side's settlement, for the post-commit live feed and chain receipts. */
interface SettledSide {
  betId: string;
  userId: string;
  walletAddress: string;
  payout: bigint;
  multiplier: number;
  won: boolean;
}

const GAME_INCLUDE = {
  creator: { select: { id: true, username: true, walletAddress: true, fundedAt: true } },
  joiner: { select: { id: true, username: true, walletAddress: true } },
  seed: true,
} as const;

/** "Open and not yet expired" — joinable, listable. */
function joinable(now = new Date()): Prisma.CoinflipGameWhereInput {
  return { status: 'open', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

/**
 * Off-chain coinflip. A creator locks `amount` lamports on a side; the other
 * side is taken either by a second player who matches the stake (PvP) or — on
 * the creator's request — by the house. The result is HMAC-SHA256 over a
 * per-flip server seed committed at create time, keyed by the player-controlled
 * seed + nonce of whoever did NOT pick the flip's timing: the joiner in PvP, the
 * creator against the house (they trigger it, so the operator never selects).
 * The winner receives 1.9× their stake — a 5% house edge either way.
 *
 * Every create/join/house/cancel runs in one Prisma transaction, and nothing is
 * broadcast until it commits.
 */
@Injectable()
export class CoinflipService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CoinflipService.name);
  private expirySweep: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CoinflipGateway,
    private readonly chain: ChainService,
    private readonly seeds: SeedManagerService,
    private readonly rg: RgService,
    private readonly affiliates: AffiliatesService,
    private readonly proofOfWager: ProofOfWagerService,
    // Optional shared on-chain RNG driver (the @Global SolanaModule supplies it);
    // when live each PvP flip's outcome is anchored on the ONE scadium_rng program.
    @Optional() private readonly onchainRng?: OnchainRngService,
    // Optional sitewide live-bet feed (the @Global LiveModule supplies it).
    @Optional() private readonly liveFeed?: LiveFeedService,
  ) {}

  onModuleInit(): void {
    // Expire what went stale while the container slept, then keep sweeping.
    void this.expireStale();
    this.expirySweep = setInterval(() => void this.expireStale(), COINFLIP.EXPIRY_SWEEP_MS);
    this.expirySweep.unref?.();
  }

  onModuleDestroy(): void {
    if (this.expirySweep) clearInterval(this.expirySweep);
    this.expirySweep = null;
  }

  // ------------ Queries ------------
  async listOpen(limit = 20, sort: 'newest' | 'amount' = 'newest') {
    const rows = await this.prisma.coinflipGame.findMany({
      where: joinable(),
      // Sorted server-side: sorting only the newest N rows on the client showed
      // a "highest" list that was just the highest of whatever arrived.
      orderBy:
        sort === 'amount'
          ? [{ amountLamports: 'desc' }, { createdAt: 'desc' }]
          : { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: GAME_INCLUDE,
    });
    return rows.map((r) => this.serialize(r));
  }

  async listRecent(limit = 20) {
    const rows = await this.prisma.coinflipGame.findMany({
      where: { status: 'completed' },
      orderBy: { resolvedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: GAME_INCLUDE,
    });
    return rows.map((r) => this.serialize(r));
  }

  /** How many flips are joinable — a count, for the header poll every client runs. */
  countOpen(): Promise<number> {
    return this.prisma.coinflipGame.count({ where: joinable() });
  }

  /** The caller's open flips — their locked stakes, whatever the lobby shows. */
  async listMine(userId: string) {
    const rows = await this.prisma.coinflipGame.findMany({
      where: { creatorId: userId, status: 'open' },
      orderBy: { createdAt: 'desc' },
      include: GAME_INCLUDE,
    });
    return rows.map((r) => this.serialize(r));
  }

  // ------------ Commands ------------
  /**
   * Create a flip. With `vsHouse` it is resolved against the house in the same
   * transaction — the way to play when nobody else is online.
   */
  async create(
    params: { userId: string; side: Side; amountLamports: bigint; vsHouse?: boolean },
    key?: string,
  ) {
    this.assertBetRange(params.amountLamports);
    await this.rg.assertCanWager(params.userId, params.amountLamports);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const replay = await claimIdempotency(tx, params.userId, 'coinflip_create', key);
      if (replay) {
        return {
          dto: replay as ReturnType<CoinflipService['serialize']>,
          replayed: true as const,
          settles: [] as SettledSide[],
        };
      }

      const user = await tx.user.findUnique({ where: { id: params.userId } });
      if (!user) throw new NotFoundException('User not found');
      if (user.banned) throw new ForbiddenException('Account banned');

      if (!params.vsHouse) {
        const open = await tx.coinflipGame.count({
          where: { creatorId: params.userId, status: 'open' },
        });
        if (open >= COINFLIP.MAX_OPEN_PER_USER) {
          throw new BadRequestException(
            `You already have ${COINFLIP.MAX_OPEN_PER_USER} open flips — cancel one, or flip against the house`,
          );
        }
      }

      // The id is generated up front so the stake debit can reference its flip
      // in the append-only ledger ("where did my 5 SOL go?").
      const gameId = randomUUID();
      // Atomic conditional debit inside the tx — closes the double-spend race.
      await applyBalanceDelta(tx, params.userId, -params.amountLamports, {
        reason: 'coinflip_stake',
        refType: 'CoinflipGame',
        refId: gameId,
      });

      // Commit a fresh per-flip server seed up-front (revealed at resolve). The
      // CLIENT seed + nonce are bound when the other side is taken (#18/#92) —
      // the server commits serverSeed before that seed is known, so it cannot
      // grind the outcome. The client seed is a placeholder until then.
      const serverSeed = generateServerSeed();
      const seed = await tx.seed.create({
        data: {
          serverSeed,
          serverSeedHash: commitServerSeed(serverSeed),
          clientSeed: '',
          nonce: 0,
        },
      });

      const game = await tx.coinflipGame.create({
        data: {
          id: gameId,
          creatorId: params.userId,
          creatorSide: params.side,
          amountLamports: params.amountLamports,
          status: 'open',
          seedId: seed.id,
          nonce: 0,
          expiresAt: params.vsHouse ? null : new Date(Date.now() + COINFLIP.OPEN_TTL_MS),
        },
        include: GAME_INCLUDE,
      });

      if (params.vsHouse) {
        const settled = await this.resolve(tx, game, { kind: 'house' });
        await storeIdempotency(tx, params.userId, 'coinflip_create', key, settled.dto);
        return { dto: settled.dto, replayed: false as const, settles: settled.settles };
      }
      const dto = this.serialize(game);
      await storeIdempotency(tx, params.userId, 'coinflip_create', key, dto);
      return { dto, replayed: false as const, settles: [] as SettledSide[] };
    });

    // Broadcast only what committed, and never again on a replay.
    if (!outcome.replayed) {
      if (outcome.dto.status === 'completed') this.afterResolve(outcome.dto, outcome.settles);
      else this.gateway.emitCreated(outcome.dto);
    }
    return outcome.dto;
  }

  async join(params: { userId: string; gameId: string }, key?: string) {
    // The joiner stakes the flip's amount in SOL, so it must count against
    // THEIR daily wager/loss limit (H20) — not 0. The stake is immutable after
    // create, so this pre-read is safe; the authoritative debit is in the tx.
    const flip = await this.prisma.coinflipGame.findUnique({
      where: { id: params.gameId },
      select: { amountLamports: true },
    });
    await this.rg.assertCanWager(params.userId, flip?.amountLamports ?? BigInt(0));

    // ON-CHAIN ANCHORING (shared scadium_rng): reserve the JOINER's seed and drive
    // a round for this flip BEFORE the settle tx, so the ~1s commit→reveal never
    // holds the tx open. The per-flip serverSeed is committed at create and is
    // IMMUTABLE until resolve, so a non-claiming pre-read is safe; the in-tx CAS
    // claim stays the only concurrency gate. Off-chain — or on ANY failure —
    // `reserved`/`onchainEntropy` stay null and the flip derives exactly as today.
    let reserved: SeedContext | null = null;
    let onchainEntropy: Uint8Array | null = null;
    if (this.onchainRng?.live) {
      const pre = await this.prisma.coinflipGame.findUnique({
        where: { id: params.gameId },
        include: { seed: true },
      });
      if (pre?.status === 'open' && pre.seed?.serverSeed && pre.creatorId !== params.userId) {
        reserved = await this.seeds.reserveSeedContext(params.userId);
        onchainEntropy = await this.onchainRng.roundEntropy({
          gameType: 'coinflip',
          roundId: this.onchainRng.nextRoundId(),
          serverSeed: pre.seed.serverSeed,
          clientSeed: reserved.clientSeed,
          nonce: Number(reserved.nonce),
          gameParams: {},
        });
      }
    }

    const settled = await this.prisma.$transaction(async (tx) => {
      // Claim/replay happens INSIDE the ledger tx so a thrown settle rolls the
      // claim back too. A replay returns the stored dto and fires NO receipts.
      const replay = await claimIdempotency(tx, params.userId, 'coinflip_join', key);
      if (replay) {
        return {
          dto: replay as ReturnType<CoinflipService['serialize']>,
          replayed: true as const,
          settles: [] as SettledSide[],
        };
      }

      const game = await tx.coinflipGame.findUnique({
        where: { id: params.gameId },
        include: GAME_INCLUDE,
      });
      if (!game) throw new NotFoundException('Flip not found');
      if (game.creatorId === params.userId) {
        throw new BadRequestException("Can't join your own flip");
      }
      // Play-money flips pair play accounts, deposited ones pair deposited (ADR 0005).
      await assertSameEconomy(tx, game.creatorId, params.userId);
      const result = await this.resolve(tx, game, {
        kind: 'player',
        userId: params.userId,
        reserved,
        onchainEntropy,
      });
      await storeIdempotency(tx, params.userId, 'coinflip_join', key, result.dto);
      return { ...result, replayed: false as const };
    });

    if (!settled.replayed) this.afterResolve(settled.dto, settled.settles);
    return settled.dto;
  }

  /**
   * The creator asks the house to take the other side of their open flip. Only
   * the creator can: they choose the moment, so the operator never gets to pick
   * which flips it takes.
   */
  async playHouse(params: { userId: string; gameId: string }) {
    const settled = await this.prisma.$transaction(async (tx) => {
      const game = await tx.coinflipGame.findUnique({
        where: { id: params.gameId },
        include: GAME_INCLUDE,
      });
      if (!game) throw new NotFoundException('Flip not found');
      if (game.creatorId !== params.userId) {
        throw new ForbiddenException('Only the creator can play this flip against the house');
      }
      return this.resolve(tx, game, { kind: 'house' });
    });
    this.afterResolve(settled.dto, settled.settles);
    return settled.dto;
  }

  async cancel(params: { userId: string; gameId: string }) {
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const game = await tx.coinflipGame.findUnique({ where: { id: params.gameId } });
      if (!game) throw new NotFoundException('Flip not found');
      if (game.creatorId !== params.userId) {
        throw new ForbiddenException('Only the creator can cancel');
      }
      if (!(await cancelOpenFlip(tx, game.id))) {
        throw new BadRequestException('Only open flips can be cancelled');
      }
      return tx.coinflipGame.findUniqueOrThrow({ where: { id: game.id }, include: GAME_INCLUDE });
    });
    this.gateway.emitCancelled({ id: cancelled.id });
    return this.serialize(cancelled);
  }

  /**
   * Cancel + refund every PvP flip whose TTL has passed. Idempotent: each goes
   * through the same compare-and-swap as a manual cancel, so a flip joined in
   * the meantime is simply skipped. Never throws — it runs on a timer.
   */
  async expireStale(): Promise<number> {
    let expired = 0;
    try {
      const stale = await this.prisma.coinflipGame.findMany({
        where: { status: 'open', expiresAt: { lte: new Date() } },
        select: { id: true },
        take: 100,
      });
      for (const { id } of stale) {
        if (await this.prisma.$transaction((tx) => cancelOpenFlip(tx, id))) {
          expired += 1;
          this.gateway.emitCancelled({ id });
        }
      }
      if (expired > 0) this.logger.log(`coinflip: expired ${expired} unjoined flip(s)`);
    } catch (e) {
      this.logger.error(
        `coinflip expiry sweep failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return expired;
  }

  // ------------ Settlement core ------------
  /**
   * Take the other side of `game` and settle it, inside the caller's tx. The
   * open→resolving compare-and-swap is the concurrency gate: two joiners (or a
   * join racing a cancel, the expiry sweep or a house call) can never both
   * claim one stake.
   */
  private async resolve(
    tx: Prisma.TransactionClient,
    game: Prisma.CoinflipGameGetPayload<{ include: typeof GAME_INCLUDE }>,
    opponent: Opponent,
  ): Promise<{ dto: ReturnType<CoinflipService['serialize']>; settles: SettledSide[] }> {
    const claimed = await tx.coinflipGame.updateMany({
      where: { id: game.id, ...joinable() },
      data: { status: 'resolving' },
    });
    if (claimed.count === 0) throw new BadRequestException('Flip not joinable');
    if (!game.seed?.serverSeed) throw new Error('Seed missing for flip');
    const stake = game.amountLamports;

    let ctx: SeedContext;
    let flipSeed = game.seed.serverSeed;
    if (opponent.kind === 'player') {
      const joiner = await tx.user.findUnique({ where: { id: opponent.userId } });
      if (!joiner) throw new NotFoundException('User not found');
      if (joiner.banned) throw new ForbiddenException('Account banned');
      // Deduct from joiner (creator already debited at create time) — atomic
      // conditional debit closes the double-spend race.
      await applyBalanceDelta(tx, opponent.userId, -stake, {
        reason: 'coinflip_stake',
        refType: 'CoinflipGame',
        refId: game.id,
      });
      // The joiner's player-controlled seed + monotonic nonce (#18/#92).
      ctx = opponent.reserved ?? (await this.seeds.consumeNonce(tx, opponent.userId));
      if (opponent.onchainEntropy) {
        flipSeed = deriveSeedContext({
          serverSeed: game.seed.serverSeed,
          clientSeed: ctx.clientSeed,
          nonce: Number(ctx.nonce),
          onchainEntropy: opponent.onchainEntropy,
        }).serverSeed;
      }
    } else {
      // Against the house the CREATOR's seed + nonce key the result: they chose
      // to call the house, after the server seed was committed.
      ctx = await this.seeds.consumeNonce(tx, game.creatorId);
    }

    const nonce = Number(ctx.nonce);
    const result = coinflipResult(flipSeed, ctx.clientSeed, nonce);
    const creatorWins = result === (game.creatorSide as Side);
    // 1.9× the stake to the winner (5% house edge): from the 2× pot in PvP, and
    // from the house's own stake when it is the other side.
    const winnerPayout =
      (stake * BigInt(Math.round(COINFLIP.PAYOUT_MULTIPLIER * 100))) / BigInt(100);

    const sides: { userId: string; side: Side; won: boolean }[] = [
      { userId: game.creatorId, side: game.creatorSide as Side, won: creatorWins },
    ];
    if (opponent.kind === 'player') {
      sides.push({
        userId: opponent.userId,
        side: game.creatorSide === 'heads' ? 'tails' : 'heads',
        won: !creatorWins,
      });
    }

    const settles: SettledSide[] = [];
    for (const s of sides) {
      const profit = winnerPayout - stake;
      await tx.user.update({
        where: { id: s.userId },
        data: s.won
          ? {
              totalWon: { increment: profit },
              totalWagered: { increment: stake },
              gamesPlayed: { increment: 1 },
            }
          : {
              totalLost: { increment: stake },
              totalWagered: { increment: stake },
              gamesPlayed: { increment: 1 },
            },
      });
      if (s.won) {
        // biggestWin = max(current, profit) as one atomic UPDATE under the row
        // lock — concurrent wins can't clobber each other via a stale read.
        await tx.$executeRaw`
          UPDATE "User" SET "biggestWin" = GREATEST("biggestWin", ${profit})
          WHERE "id" = ${s.userId}::uuid
        `;
      }
      await this.proofOfWager.accrue(tx, {
        userId: s.userId,
        gameType: 'coinflip',
        stakeLamports: stake,
      });

      const betId = randomUUID();
      const payout = s.won ? winnerPayout : BigInt(0);
      const multiplier = s.won ? COINFLIP.PAYOUT_MULTIPLIER : 0;
      await tx.bet.create({
        data: {
          id: betId,
          userId: s.userId,
          gameType: 'coinflip',
          amountLamports: stake,
          payoutLamports: payout,
          multiplier,
          status: s.won ? 'won' : 'lost',
          seedId: game.seedId!,
          nonce,
          // Full verification context so either player can reproduce the result
          // via @scadium/fair once the seed is revealed. serverSeedHash is the
          // FLIP's commitment (the seed the result is keyed by).
          resultJson: {
            side: s.side,
            result,
            won: s.won,
            vsHouse: opponent.kind === 'house',
            serverSeedHash: game.seed.serverSeedHash,
            clientSeed: ctx.clientSeed,
            nonce,
          },
        },
      });
      if (s.won) {
        // Credit the winner through the single mutation point (ledger row in
        // this tx), referencing their Bet row.
        await applyBalanceDelta(tx, s.userId, winnerPayout, {
          reason: 'coinflip_payout',
          refType: 'Bet',
          refId: betId,
        });
      }
      // Each human side's stake accrues to its referrer (#47), in this tx.
      await this.affiliates.creditReferral(tx, s.userId, stake, 'coinflip');
      const wallet = s.userId === game.creatorId ? game.creator.walletAddress : '';
      settles.push({
        betId,
        userId: s.userId,
        walletAddress: wallet,
        payout,
        multiplier,
        won: s.won,
      });
    }

    // Bind the seed that keyed the result onto the flip's seed row, and reveal
    // the per-flip server seed now that it is settled.
    await tx.seed.update({
      where: { id: game.seedId! },
      data: { clientSeed: ctx.clientSeed, nonce, revealedAt: new Date() },
    });

    const winnerId = creatorWins
      ? game.creatorId
      : opponent.kind === 'player'
        ? opponent.userId
        : null; // the house won
    const updated = await tx.coinflipGame.update({
      where: { id: game.id },
      data: {
        joinerId: opponent.kind === 'player' ? opponent.userId : null,
        vsHouse: opponent.kind === 'house',
        result,
        winnerId,
        status: 'completed',
        resolvedAt: new Date(),
        nonce,
        expiresAt: null,
      },
      include: GAME_INCLUDE,
    });
    // The joiner's wallet is known only now.
    for (const s of settles) {
      if (!s.walletAddress) s.walletAddress = updated.joiner?.walletAddress ?? '';
    }

    this.logger.log(
      `Flip ${updated.id} resolved${opponent.kind === 'house' ? ' vs house' : ''}: ${result} — ` +
        `winner=${winnerId ? winnerId.slice(0, 8) : 'house'} stake=${stake}`,
    );
    return { dto: this.serialize(updated), settles };
  }

  /** Post-commit side effects of a resolved flip: broadcast, live feed, chain receipts. */
  private afterResolve(dto: ReturnType<CoinflipService['serialize']>, settles: SettledSide[]) {
    this.gateway.emitResolved(dto);
    const stake = BigInt(dto.amountLamports);
    for (const s of settles) {
      this.liveFeed?.publishSettledBet({
        userId: s.userId,
        betId: s.betId,
        gameType: 'coinflip',
        amountLamports: stake,
        payoutLamports: s.payout,
        multiplier: s.multiplier,
        won: s.won,
      });
    }
    // On-chain settlement receipts fire AFTER the ledger transaction commits
    // (fire-and-forget — never blocks the response; no-op when disabled).
    if (!this.chain.enabled) return;
    for (const s of settles) {
      void this.chain
        .recordBet({
          betId: s.betId,
          walletAddress: s.walletAddress,
          game: 'coinflip',
          stakeLamports: stake,
          payoutLamports: s.payout,
          multiplier: s.multiplier,
        })
        .then(async (sig) => {
          if (sig) {
            await this.prisma.bet.update({ where: { id: s.betId }, data: { txSignature: sig } });
          }
        })
        .catch((e: unknown) =>
          this.logger.error(`on-chain record failed for ${s.betId}: ${String(e)}`),
        );
    }
  }

  // ------------ Helpers ------------
  private assertBetRange(amount: bigint) {
    if (amount < BigInt(COINFLIP.MIN_BET_LAMPORTS) || amount > BigInt(COINFLIP.MAX_BET_LAMPORTS)) {
      throw new BadRequestException(
        `Bet out of range (${COINFLIP.MIN_BET_LAMPORTS}-${COINFLIP.MAX_BET_LAMPORTS} lamports)`,
      );
    }
  }

  private serialize(game: {
    id: string;
    creatorId: string;
    creatorSide: string;
    creator?: {
      id: string;
      username: string | null;
      walletAddress: string;
      fundedAt?: Date | null;
    } | null;
    joinerId: string | null;
    joiner?: { id: string; username: string | null; walletAddress: string } | null;
    amountLamports: bigint;
    result: string | null;
    winnerId: string | null;
    status: string;
    vsHouse: boolean;
    expiresAt: Date | null;
    createdAt: Date;
    resolvedAt: Date | null;
    seed?: { serverSeedHash: string; serverSeed: string | null; clientSeed: string } | null;
    nonce: number | null;
  }) {
    return {
      id: game.id,
      creatorId: game.creatorId,
      creatorUsername: game.creator?.username ?? null,
      creatorWallet: game.creator?.walletAddress ?? null,
      creatorSide: game.creatorSide,
      // Deposited-SOL flip vs play-money flip: only the same kind may join (ADR 0005).
      creatorFunded: game.creator?.fundedAt != null,
      joinerId: game.joinerId,
      joinerUsername: game.joiner?.username ?? null,
      joinerWallet: game.joiner?.walletAddress ?? null,
      vsHouse: game.vsHouse,
      amountLamports: game.amountLamports.toString(),
      result: game.result,
      winnerId: game.winnerId,
      status: game.status,
      createdAt: game.createdAt.toISOString(),
      resolvedAt: game.resolvedAt?.toISOString() ?? null,
      expiresAt: game.expiresAt?.toISOString() ?? null,
      serverSeedHash: game.seed?.serverSeedHash ?? null,
      serverSeed: game.status === 'completed' ? (game.seed?.serverSeed ?? null) : null,
      clientSeed: game.seed?.clientSeed ?? null,
      nonce: game.nonce,
    };
  }
}
