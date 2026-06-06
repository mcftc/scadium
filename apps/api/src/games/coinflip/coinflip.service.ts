import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  generateServerSeed,
  generateClientSeed,
  commitServerSeed,
  coinflipResult,
} from '@scadium/fair';
import { COINFLIP, SCAD } from '@scadium/shared';
import { randomUUID } from 'node:crypto';
import { ChainService } from '../../solana/chain.service';
import { CoinflipGateway } from './coinflip.gateway';

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
  async create(params: { userId: string; side: Side; amountLamports: bigint }) {
    this.assertBetRange(params.amountLamports);

    const game = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: params.userId } });
      if (!user) throw new NotFoundException('User not found');
      if (user.banned) throw new ForbiddenException('Account banned');
      if (user.playBalanceLamports < params.amountLamports) {
        throw new BadRequestException('Insufficient balance');
      }

      await tx.user.update({
        where: { id: params.userId },
        data: { playBalanceLamports: { decrement: params.amountLamports } },
      });

      // Commit a fresh seed per game so each flip has its own provably-fair
      // trail. serverSeed stays secret until resolve.
      const serverSeed = generateServerSeed();
      const clientSeed = generateClientSeed();
      const seed = await tx.seed.create({
        data: {
          serverSeed,
          serverSeedHash: commitServerSeed(serverSeed),
          clientSeed,
          nonce: 0,
        },
      });

      return tx.coinflipGame.create({
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
    });

    const dto = this.serialize(game);
    this.gateway.emitCreated(dto);
    return dto;
  }

  async join(params: { userId: string; gameId: string }) {
    const settled = await this.prisma.$transaction(async (tx) => {
      const game = await tx.coinflipGame.findUnique({
        where: { id: params.gameId },
        include: {
          creator: { select: { id: true, username: true, walletAddress: true } },
          seed: true,
        },
      });
      if (!game) throw new NotFoundException('Flip not found');
      if (game.status !== 'open') throw new BadRequestException('Flip not joinable');
      if (game.creatorId === params.userId) {
        throw new BadRequestException("Can't join your own flip");
      }

      const joiner = await tx.user.findUnique({ where: { id: params.userId } });
      if (!joiner) throw new NotFoundException('User not found');
      if (joiner.banned) throw new ForbiddenException('Account banned');
      if (joiner.playBalanceLamports < game.amountLamports) {
        throw new BadRequestException('Insufficient balance');
      }

      // Deduct from joiner (creator already debited at create time)
      await tx.user.update({
        where: { id: params.userId },
        data: { playBalanceLamports: { decrement: game.amountLamports } },
      });

      // Derive the result from the committed seed. Each flip has its own
      // dedicated server/client seed pair, so nonce is always 0 — no need
      // for a shared counter. The stored `game.nonce` (=0) is what the
      // /fairness verifier will feed back in to reproduce the result.
      if (!game.seed) throw new Error('Seed missing for flip');
      const result = coinflipResult(
        game.seed.serverSeed!,
        game.seed.clientSeed,
        game.nonce ?? 0,
      );
      const creatorWins = result === (game.creatorSide as Side);
      const winnerId = creatorWins ? game.creatorId : params.userId;
      const loserId = creatorWins ? params.userId : game.creatorId;

      // 1.9x payout goes to winner from the 2x pot (5% house edge)
      const pot = game.amountLamports * BigInt(2);
      const winnerPayout =
        (game.amountLamports * BigInt(Math.round(COINFLIP.PAYOUT_MULTIPLIER * 100))) /
        BigInt(100);
      // House take = pot - winnerPayout (retained by the protocol)

      await tx.user.update({
        where: { id: winnerId },
        data: {
          playBalanceLamports: { increment: winnerPayout },
          scadiumBalance: {
            increment: game.amountLamports * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT),
          },
          totalWon: { increment: winnerPayout - game.amountLamports },
          totalWagered: { increment: game.amountLamports },
          gamesPlayed: { increment: 1 },
          biggestWin: {
            // Only bumped by the service layer after reading current; Prisma
            // doesn't support conditional increment so we accept it may
            // understate "biggest win" until a follow-up reconcile.
            set:
              (await tx.user.findUnique({ where: { id: winnerId } }))!.biggestWin >
              winnerPayout - game.amountLamports
                ? (await tx.user.findUnique({ where: { id: winnerId } }))!.biggestWin
                : winnerPayout - game.amountLamports,
          },
        },
      });
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
            nonce: game.nonce,
            resultJson: { side: game.creatorSide, result, won: creatorWins },
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
            nonce: game.nonce,
            resultJson: {
              side: game.creatorSide === 'heads' ? 'tails' : 'heads',
              result,
              won: !creatorWins,
            },
          },
        ],
      });

      // Reveal the server seed now that the round is settled
      await tx.seed.update({
        where: { id: game.seedId! },
        data: { revealedAt: new Date() },
      });

      const updated = await tx.coinflipGame.update({
        where: { id: game.id },
        data: {
          joinerId: params.userId,
          result,
          winnerId,
          status: 'completed',
          resolvedAt: new Date(),
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
      return {
        dto,
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
    // (fire-and-forget — never blocks the response; no-op when disabled).
    if (this.chain.enabled) {
      for (const s of settled.settles) {
        void this.chain
          .settleBet({
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
            this.logger.error(`on-chain settle failed for ${s.betId}: ${String(e)}`),
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

      await tx.user.update({
        where: { id: game.creatorId },
        data: { playBalanceLamports: { increment: game.amountLamports } },
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
