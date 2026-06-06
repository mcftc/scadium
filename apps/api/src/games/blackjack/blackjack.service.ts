import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import {
  blackjackDeal,
  generateServerSeed,
  generateClientSeed,
  commitServerSeed,
  handValue,
  isBust,
  isBlackjack,
} from '@scadium/fair';
import type { Card } from '@scadium/shared';
import { BLACKJACK, SCAD } from '@scadium/shared';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainService } from '../../solana/chain.service';

type HandStatus = 'playing' | 'standing' | 'busted' | 'blackjack';

interface Hand {
  cards: Card[];
  status: HandStatus;
  bet: bigint;
  doubled: boolean;
}

interface RoundState {
  userId: string;
  betLamports: bigint;
  seedId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  deckIndex: number; // next card to draw
  playerHand: Hand;
  dealerHand: Card[];
  dealerHidden: boolean;
  phase: 'player' | 'dealer' | 'settled';
  result?: 'win' | 'lose' | 'push' | 'blackjack';
  payoutLamports?: bigint;
}

/**
 * Solo blackjack implementation. A player starts a hand with a bet; the
 * service deals cards deterministically from a fresh committed seed and
 * tracks per-user state in memory until the hand settles. At settlement
 * the ledger is updated and the hand is purged.
 *
 * Rules: dealer hits on soft 17, blackjack pays 3:2, double allowed on
 * any two, no split in this phase (scope-limited to keep the phase
 * focused).
 */
@Injectable()
export class BlackjackService {
  private readonly logger = new Logger(BlackjackService.name);
  private readonly active = new Map<string, RoundState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
  ) {}

  getActive(userId: string) {
    const s = this.active.get(userId);
    if (!s) return null;
    return this.serialize(s);
  }

  async start(params: { userId: string; amountLamports: bigint }) {
    if (
      params.amountLamports < BigInt(BLACKJACK.MIN_BET_LAMPORTS) ||
      params.amountLamports > BigInt(BLACKJACK.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException('Bet out of range');
    }

    if (this.active.has(params.userId)) {
      throw new BadRequestException('You already have an active hand');
    }

    const user = await this.prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.banned) throw new ForbiddenException('Account banned');
    if (user.playBalanceLamports < params.amountLamports) {
      throw new BadRequestException('Insufficient balance');
    }

    // Debit at deal time
    await this.prisma.user.update({
      where: { id: params.userId },
      data: { playBalanceLamports: { decrement: params.amountLamports } },
    });

    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const seed = await this.prisma.seed.create({
      data: {
        serverSeed,
        serverSeedHash: commitServerSeed(serverSeed),
        clientSeed,
        nonce: 0,
      },
    });

    // Deal enough cards to cover worst-case play (player + dealer + hits)
    const cards = blackjackDeal(serverSeed, clientSeed, 0, 20);
    const state: RoundState = {
      userId: params.userId,
      betLamports: params.amountLamports,
      seedId: seed.id,
      serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed,
      nonce: 0,
      deckIndex: 4,
      playerHand: {
        cards: [cards[0]!, cards[2]!],
        status: 'playing',
        bet: params.amountLamports,
        doubled: false,
      },
      dealerHand: [cards[1]!, cards[3]!],
      dealerHidden: true,
      phase: 'player',
    };

    // Immediate blackjack check
    if (isBlackjack(state.playerHand.cards)) {
      state.playerHand.status = 'blackjack';
      await this.dealerPlayAndSettle(state, cards);
    }

    this.active.set(params.userId, state);
    return this.serialize(state);
  }

  async action(params: { userId: string; action: 'hit' | 'stand' | 'double' }) {
    const state = this.active.get(params.userId);
    if (!state) throw new NotFoundException('No active hand');
    if (state.phase !== 'player') throw new BadRequestException('Not your turn');

    // Regenerate the deck from the committed seed so we don't have to cache it
    const deck = blackjackDeal(state.serverSeed, state.clientSeed, 0, 30);

    if (params.action === 'hit') {
      state.playerHand.cards.push(deck[state.deckIndex]!);
      state.deckIndex++;
      if (isBust(state.playerHand.cards)) {
        state.playerHand.status = 'busted';
        await this.dealerPlayAndSettle(state, deck);
      }
    } else if (params.action === 'stand') {
      state.playerHand.status = 'standing';
      await this.dealerPlayAndSettle(state, deck);
    } else if (params.action === 'double') {
      if (state.playerHand.cards.length !== 2) {
        throw new BadRequestException('Double only allowed on first two cards');
      }
      // Debit the additional bet
      const user = await this.prisma.user.findUnique({ where: { id: params.userId } });
      if (!user || user.playBalanceLamports < state.betLamports) {
        throw new BadRequestException('Insufficient balance to double');
      }
      await this.prisma.user.update({
        where: { id: params.userId },
        data: { playBalanceLamports: { decrement: state.betLamports } },
      });
      state.playerHand.bet = state.betLamports * BigInt(2);
      state.playerHand.doubled = true;
      state.playerHand.cards.push(deck[state.deckIndex]!);
      state.deckIndex++;
      if (isBust(state.playerHand.cards)) {
        state.playerHand.status = 'busted';
      } else {
        state.playerHand.status = 'standing';
      }
      await this.dealerPlayAndSettle(state, deck);
    }

    return this.serialize(state);
  }

  private async dealerPlayAndSettle(state: RoundState, deck: Card[]) {
    state.phase = 'dealer';
    state.dealerHidden = false;

    // Dealer hits on soft 17
    if (state.playerHand.status !== 'busted') {
      while (true) {
        const { total, soft } = handValue(state.dealerHand);
        if (total > 17) break;
        if (total === 17 && !soft) break;
        state.dealerHand.push(deck[state.deckIndex]!);
        state.deckIndex++;
        if (state.deckIndex >= deck.length) break;
      }
    }

    // Resolve
    const playerTotal = handValue(state.playerHand.cards).total;
    const dealerTotal = handValue(state.dealerHand).total;
    const dealerBust = dealerTotal > 21;
    const bet = state.playerHand.bet;

    let result: 'win' | 'lose' | 'push' | 'blackjack';
    let payout = BigInt(0);

    if (state.playerHand.status === 'busted') {
      result = 'lose';
    } else if (state.playerHand.status === 'blackjack') {
      if (isBlackjack(state.dealerHand)) {
        result = 'push';
        payout = bet;
      } else {
        result = 'blackjack';
        // 3:2 payout on the bet + return the bet = bet * 2.5
        payout = (bet * BigInt(5)) / BigInt(2);
      }
    } else if (dealerBust || playerTotal > dealerTotal) {
      result = 'win';
      payout = bet * BigInt(2);
    } else if (playerTotal === dealerTotal) {
      result = 'push';
      payout = bet;
    } else {
      result = 'lose';
    }

    state.phase = 'settled';
    state.result = result;
    state.payoutLamports = payout;

    // Reveal seed
    await this.prisma.seed.update({
      where: { id: state.seedId },
      data: { revealedAt: new Date() },
    });

    // Update ledger + Bet row
    const won = result === 'win' || result === 'blackjack';
    const profit = payout - bet;
    const settledUser = await this.prisma.user.update({
      where: { id: state.userId },
      data: {
        playBalanceLamports: { increment: payout },
        scadiumBalance: { increment: bet * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT) },
        totalWagered: { increment: bet },
        totalWon: won ? { increment: profit } : undefined,
        totalLost: result === 'lose' ? { increment: bet } : undefined,
        gamesPlayed: { increment: 1 },
      },
    });
    const betId = randomUUID();
    await this.prisma.bet.create({
      data: {
        id: betId,
        userId: state.userId,
        gameType: 'blackjack',
        amountLamports: bet,
        payoutLamports: payout,
        multiplier:
          result === 'blackjack'
            ? 2.5
            : result === 'win'
              ? 2.0
              : result === 'push'
                ? 1.0
                : 0,
        status: won ? 'won' : result === 'push' ? 'refunded' : 'lost',
        seedId: state.seedId,
        nonce: 0,
        resultJson: {
          playerCards: state.playerHand.cards.map((c) => `${c.rank}${c.suit}`),
          dealerCards: state.dealerHand.map((c) => `${c.rank}${c.suit}`),
          playerTotal,
          dealerTotal,
          result,
        },
      },
    });

    // Fire-and-forget on-chain settlement receipt (no-op when disabled).
    if (this.chain.enabled) {
      const mult =
        result === 'blackjack' ? 2.5 : result === 'win' ? 2.0 : result === 'push' ? 1.0 : 0;
      void this.chain
        .settleBet({
          betId,
          walletAddress: settledUser.walletAddress,
          game: 'blackjack',
          stakeLamports: bet,
          payoutLamports: payout,
          multiplier: mult,
        })
        .then(async (sig) => {
          if (sig) {
            await this.prisma.bet.update({ where: { id: betId }, data: { txSignature: sig } });
          }
        })
        .catch((e: unknown) =>
          this.logger.error(`on-chain settle failed for ${betId}: ${String(e)}`),
        );
    }

    // Clear from in-memory active map after a short delay so the client can
    // read the final state before it vanishes.
    setTimeout(() => {
      this.active.delete(state.userId);
    }, 30_000);
  }

  private serialize(s: RoundState) {
    return {
      betLamports: s.betLamports.toString(),
      phase: s.phase,
      playerCards: s.playerHand.cards,
      playerTotal: handValue(s.playerHand.cards).total,
      playerStatus: s.playerHand.status,
      playerBet: s.playerHand.bet.toString(),
      doubled: s.playerHand.doubled,
      dealerCards: s.dealerHidden ? [s.dealerHand[0], null] : s.dealerHand,
      dealerTotal: s.dealerHidden ? null : handValue(s.dealerHand).total,
      result: s.result ?? null,
      payoutLamports: s.payoutLamports?.toString() ?? null,
      serverSeedHash: s.serverSeedHash,
      serverSeed: s.phase === 'settled' ? s.serverSeed : null,
      clientSeed: s.clientSeed,
      canHit: s.phase === 'player' && s.playerHand.status === 'playing',
      canStand: s.phase === 'player' && s.playerHand.status === 'playing',
      canDouble:
        s.phase === 'player' &&
        s.playerHand.status === 'playing' &&
        s.playerHand.cards.length === 2 &&
        !s.playerHand.doubled,
    };
  }
}
