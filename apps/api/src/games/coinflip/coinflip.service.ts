import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { generateServerSeed, commitServerSeed, coinflipResult } from '@scadium/fair';
import { COINFLIP, SCAD } from '@scadium/shared';
import { randomUUID } from 'node:crypto';
import { ChainService } from '../../solana/chain.service';
import { SeedManagerService } from '../../fairness/seed-manager.service';
import { RgService } from '../../responsible-gambling/rg.service';
import { AffiliatesService } from '../../affiliates/affiliates.service';
import { CoinflipGateway } from './coinflip.gateway';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';
import { claimIdempotency, storeIdempotency } from '../../prisma/idempotency';

type Side = 'heads' | 'tails';

/**
 * Off-chain coinflip game loop. A creator locks `amount` lamports choosing a
 * side; a joiner matches the same amount taking the opposite side. On join,
 * the result is derived via HMAC-SHA256 from a server-committed seed plus
 * the joiner's clientSeed and the round nonce. Winner receives 1.9x their
 * stake — the 5% house edge is the product owner's margin.
 *
 * Balances update atomically inside a Prisma transaction so a failed
 * resolve never leaves the ledger inconsistent.
 */
@Injectable()
export class CoinflipService {
  private readonly logger = new Logger(CoinflipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CoinflipGateway,
    private readonly chain: ChainService,
    private readonly seeds: SeedManagerService,
    private readonly rg: RgService,
    private readonly affiliates: AffiliatesService,
  ) {}

  // ------------ Queries ------------
  async listOpen(limit = 20) {
    const rows = await this.prisma.coinflipGame.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        creator: { select: { id: true, username: true, walletAddress: true } },
        seed: true,
      },
    });
    return rows.map((r) => this.serialize(r));
  }

  async listRecent(limit = 20) {
    const rows = await this.prisma.coinflipGame.findMany({
      where: { status: 'completed' },
      orderBy: { resolvedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        creator: { select: { id: true, username: true, walletAddress: true } },
        joiner: { select: { id: true, username: true, walletAddress: true } },
        seed: true,
      },
    });
    return rows.map((r) => this.serialize(r));
  }

  // ------------ Commands ------------
  async create(params: { userId: string; side: Side; amountLamports: bigint }, key?: string) {
    this.assertBetRange(params.amountLamports);
    await this.rg.assertCanWager(params.userId, params.amountLamports);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const replay = await claimIdempotency(tx, params.userId, 'coinflip_create', key);
      if (replay) {
        return { dto: replay as ReturnType<typeof this.serialize>, replayed: true };
      }

      const user = await tx.user.findUnique({ where: { id: params.userId } });
      if (!user) throw new NotFoundException('User not found');
      if (user.banned) throw new ForbiddenException('Account banned');

      // Atomic conditional debit inside the tx — closes the double-spend race.
      // refId is null: the game row is created later in this same tx.
      await applyBalanceDelta(tx, params.userId, -params.amountLamports, {
        reason: 'coinflip_stake',
        refType: 'CoinflipGame',
        refId: null,
      });

      // Commit a fresh per-flip server seed up-front (revealed at resolve). The
      // CLIENT seed + nonce are the JOINER's player-controlled values, bound at
      // join time (#18/#92) — the server commits serverSeed BEFORE the joiner (and
      // their seed) is known, so it cannot grind the outcome. The client seed is a
      // placeholder until a joiner binds theirs.
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
          creatorId: params.userId,
          creatorSide: params.side,
          amountLamports: params.amountLamports,
          status: 'open',
          seedId: seed.id,
          nonce: 0,
        },
        include: {
          creator: { select: { id: true, username: true, walletAddress: true } },
          seed: true,
        },
      });

      const dto = this.serialize(game);
      await storeIdempotency(tx, params.userId, 'coinflip_create', key, dto);
      return { dto, replayed: false };
    });

    // Skip the realtime broadcast on replay — the original create already fired.
    if (!outcome.replayed) this.gateway.emitCreated(outcome.dto);
    return outcome.dto;
  }

  async join(params: { userId: string; gameId: string }, key?: string) {
    // Self-exclusion / cooling-off block (0n: the SOL limit is keyed off the
    // create stake; joins still hard-block excluded/cooling-off users).
    await this.rg.assertCanWager(params.userId, 0n);
    const settled = await this.prisma.$transaction(async (tx) => {
      // Claim/replay happens INSIDE the ledger tx so a thrown settle rolls the
      // claim back too. A replay returns the stored dto and fires NO chain
      // receipts (the original join already fired them).
      const replay = await claimIdempotency(tx, params.userId, 'coinflip_join', key);
      if (replay) {
        return {
          dto: replay as ReturnType<typeof this.serialize>,
          replayed: true as const,
          stake: BigInt(0),
          settles: [] as {
            betId: string;
            walletAddress: string;
            payout: bigint;
            multiplier: number;
          }[],
        };
      }

      const game = await tx.coinflipGame.findUnique({
        where: { id: params.gameId },
        include: {
          creator: { select: { id: true, username: true, walletAddress: true } },
          seed: true,
        },
      });
      if (!game) throw new NotFoundException('Flip not found');
      if (game.creatorId === params.userId) {
        throw new BadRequestException("Can't join your own flip");
      }

      // Compare-and-swap the status open→resolving so only ONE concurrent
      // joiner can claim this flip. Without it two joiners both read
      // status='open' and the single creator stake funds two payouts.
      const claimed = await tx.coinflipGame.updateMany({
        where: { id: params.gameId, status: 'open' },
        data: { status: 'resolving' },
      });
      if (claimed.count === 0) throw new BadRequestException('Flip not joinable');

      const joiner = await tx.user.findUnique({ where: { id: params.userId } });
      if (!joiner) throw new NotFoundException('User not found');
      if (joiner.banned) throw new ForbiddenException('Account banned');

      // Deduct from joiner (creator already debited at create time) — atomic
      // conditional debit closes the double-spend race.
      await applyBalanceDelta(tx, params.userId, -game.amountLamports, {
        reason: 'coinflip_stake',
        refType: 'CoinflipGame',
        refId: game.id,
      });

      // Player-controlled fairness inputs (#18/#92): the JOINER's active client
      // seed + a monotonic per-user nonce, consumed atomically inside this tx. The
      // per-flip serverSeed was committed at create (before the joiner/their seed
      // was known), so the operator cannot grind the outcome.
      if (!game.seed) throw new Error('Seed missing for flip');
      const ctx = await this.seeds.consumeNonce(tx, params.userId);
      const flipNonce = Number(ctx.nonce);
      const result = coinflipResult(game.seed.serverSeed!, ctx.clientSeed, flipNonce);
      const creatorWins = result === (game.creatorSide as Side);
      const winnerId = creatorWins ? game.creatorId : params.userId;
      const loserId = creatorWins ? params.userId : game.creatorId;

      // 1.9x payout goes to winner from the 2x pot (5% house edge)
      const pot = game.amountLamports * BigInt(2);
      const winnerPayout =
        (game.amountLamports * BigInt(Math.round(COINFLIP.PAYOUT_MULTIPLIER * 100))) /
        BigInt(100);
      // House take = pot - winnerPayout (retained by the protocol)

      const profit = winnerPayout - game.amountLamports;

      await tx.user.update({
        where: { id: winnerId },
        data: {
          scadiumBalance: {
            increment: game.amountLamports * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT),
          },
          totalWon: { increment: profit },
          totalWagered: { increment: game.amountLamports },
          gamesPlayed: { increment: 1 },
        },
      });
      // biggestWin = max(current, profit) as a SINGLE atomic SQL update.
      // GREATEST runs under the row's write lock, so concurrent winning flips
      // for the same user can't clobber each other via a stale read-then-write
      // (the prior nested-findUnique bug) — no understatement under concurrency.
      await tx.$executeRaw`
        UPDATE "User" SET "biggestWin" = GREATEST("biggestWin", ${profit})
        WHERE "id" = ${winnerId}::uuid
      `;
      await tx.user.update({
        where: { id: loserId },
        data: {
          scadiumBalance: {
            increment: game.amountLamports * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT),
          },
          totalLost: { increment: game.amountLamports },
          totalWagered: { increment: game.amountLamports },
          gamesPlayed: { increment: 1 },
        },
      });

      // Record two Bet rows so bet history shows both sides. Ids are
      // pre-generated so the post-commit on-chain settlement receipts can
      // reference them without re-querying.
      const creatorBetId = randomUUID();
      const joinerBetId = randomUUID();
      await tx.bet.createMany({
        data: [
          {
            id: creatorBetId,
            userId: game.creatorId,
            gameType: 'coinflip',
            amountLamports: game.amountLamports,
            payoutLamports: creatorWins ? winnerPayout : BigInt(0),
            multiplier: creatorWins ? COINFLIP.PAYOUT_MULTIPLIER : 0,
            status: creatorWins ? 'won' : 'lost',
            seedId: game.seedId!,
            nonce: flipNonce,
            // Full verification context so either player can independently
            // reproduce the result via @scadium/fair after the seed is revealed.
            resultJson: {
              side: game.creatorSide,
              result,
              won: creatorWins,
              serverSeedHash: ctx.serverSeedHash,
              clientSeed: ctx.clientSeed,
              nonce: flipNonce,
            },
          },
          {
            id: joinerBetId,
            userId: params.userId,
            gameType: 'coinflip',
            amountLamports: game.amountLamports,
            payoutLamports: creatorWins ? BigInt(0) : winnerPayout,
            multiplier: creatorWins ? 0 : COINFLIP.PAYOUT_MULTIPLIER,
            status: creatorWins ? 'lost' : 'won',
            seedId: game.seedId!,
            nonce: flipNonce,
            resultJson: {
              side: game.creatorSide === 'heads' ? 'tails' : 'heads',
              result,
              won: !creatorWins,
              serverSeedHash: ctx.serverSeedHash,
              clientSeed: ctx.clientSeed,
              nonce: flipNonce,
            },
          },
        ],
      });

      // Credit the winner's play balance through the single mutation point
      // (writes a ledger row in this tx), referencing the winner's Bet row.
      await applyBalanceDelta(tx, winnerId, winnerPayout, {
        reason: 'coinflip_payout',
        refType: 'Bet',
        refId: creatorWins ? creatorBetId : joinerBetId,
      });

      // Accrue both wagering sides' stakes to their referrers (#47) — in this
      // settle tx, so it's atomic + replay-safe (the idempotency claim above
      // guards re-entry). No-op for users with no referrer.
      await this.affiliates.creditReferral(tx, game.creatorId, game.amountLamports);
      await this.affiliates.creditReferral(tx, params.userId, game.amountLamports);

      // Bind the joiner's player seed + nonce onto the flip's seed row and reveal
      // the per-flip server seed now that the round is settled.
      await tx.seed.update({
        where: { id: game.seedId! },
        data: { clientSeed: ctx.clientSeed, nonce: flipNonce, revealedAt: new Date() },
      });

      const updated = await tx.coinflipGame.update({
        where: { id: game.id },
        data: {
          joinerId: params.userId,
          result,
          winnerId,
          status: 'completed',
          resolvedAt: new Date(),
          nonce: flipNonce,
        },
        include: {
          creator: { select: { id: true, username: true, walletAddress: true } },
          joiner: { select: { id: true, username: true, walletAddress: true } },
          seed: true,
        },
      });

      this.logger.log(
        `Flip ${updated.id} resolved: ${result} — winner=${winnerId.slice(0, 8)} pot=${pot}`,
      );

      const dto = this.serialize(updated);
      this.gateway.emitResolved(dto);
      await storeIdempotency(tx, params.userId, 'coinflip_join', key, dto);
      return {
        dto,
        replayed: false as const,
        stake: game.amountLamports,
        settles: [
          {
            betId: creatorBetId,
            walletAddress: updated.creator!.walletAddress,
            payout: creatorWins ? winnerPayout : BigInt(0),
            multiplier: creatorWins ? COINFLIP.PAYOUT_MULTIPLIER : 0,
          },
          {
            betId: joinerBetId,
            walletAddress: updated.joiner!.walletAddress,
            payout: creatorWins ? BigInt(0) : winnerPayout,
            multiplier: creatorWins ? 0 : COINFLIP.PAYOUT_MULTIPLIER,
          },
        ],
      };
    });

    // On-chain settlement receipts fire AFTER the ledger transaction commits
    // (fire-and-forget — never blocks the response; no-op when disabled). On a
    // replay there are no settles, so receipts are inherently skipped.
    if (!settled.replayed && this.chain.enabled) {
      for (const s of settled.settles) {
        void this.chain
          .recordBet({
            betId: s.betId,
            walletAddress: s.walletAddress,
            game: 'coinflip',
            stakeLamports: settled.stake,
            payoutLamports: s.payout,
            multiplier: s.multiplier,
          })
          .then(async (sig) => {
            if (sig) {
              await this.prisma.bet.update({
                where: { id: s.betId },
                data: { txSignature: sig },
              });
            }
          })
          .catch((e: unknown) =>
            this.logger.error(`on-chain record failed for ${s.betId}: ${String(e)}`),
          );
      }
    }
    return settled.dto;
  }

  async cancel(params: { userId: string; gameId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const game = await tx.coinflipGame.findUnique({ where: { id: params.gameId } });
      if (!game) throw new NotFoundException('Flip not found');
      if (game.creatorId !== params.userId) {
        throw new ForbiddenException('Only the creator can cancel');
      }
      if (game.status !== 'open') {
        throw new BadRequestException('Only open flips can be cancelled');
      }

      await applyBalanceDelta(tx, game.creatorId, game.amountLamports, {
        reason: 'refund',
        refType: 'CoinflipGame',
        refId: game.id,
      });

      const cancelled = await tx.coinflipGame.update({
        where: { id: game.id },
        data: { status: 'cancelled', resolvedAt: new Date() },
        include: {
          creator: { select: { id: true, username: true, walletAddress: true } },
        },
      });

      this.gateway.emitCancelled({ id: cancelled.id });
      return this.serialize(cancelled);
    });
  }

  // ------------ Helpers ------------
  private assertBetRange(amount: bigint) {
    if (
      amount < BigInt(COINFLIP.MIN_BET_LAMPORTS) ||
      amount > BigInt(COINFLIP.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException(
        `Bet out of range (${COINFLIP.MIN_BET_LAMPORTS}-${COINFLIP.MAX_BET_LAMPORTS} lamports)`,
      );
    }
  }

  private serialize(game: {
    id: string;
    creatorId: string;
    creatorSide: string;
    creator?: { id: string; username: string | null; walletAddress: string } | null;
    joinerId: string | null;
    joiner?: { id: string; username: string | null; walletAddress: string } | null;
    amountLamports: bigint;
    result: string | null;
    winnerId: string | null;
    status: string;
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
      joinerId: game.joinerId,
      joinerUsername: game.joiner?.username ?? null,
      joinerWallet: game.joiner?.walletAddress ?? null,
      amountLamports: game.amountLamports.toString(),
      result: game.result,
      winnerId: game.winnerId,
      status: game.status,
      createdAt: game.createdAt.toISOString(),
      resolvedAt: game.resolvedAt?.toISOString() ?? null,
      serverSeedHash: game.seed?.serverSeedHash ?? null,
      serverSeed: game.status === 'completed' ? (game.seed?.serverSeed ?? null) : null,
      clientSeed: game.seed?.clientSeed ?? null,
      nonce: game.nonce,
    };
  }
}
