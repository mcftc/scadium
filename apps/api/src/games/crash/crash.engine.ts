import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { crashPoint, generateServerSeed, generateClientSeed, commitServerSeed } from '@scadium/fair';
import { CRASH } from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CrashGateway } from './crash.gateway';

type Phase = 'waiting' | 'running' | 'busted';

interface LiveBet {
  userId: string;
  username: string | null;
  walletAddress: string;
  amountLamports: bigint;
  autoCashout: number | null;
  cashedOutAt: number | null; // multiplier at which user cashed out
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
export class CrashEngine implements OnModuleInit {
  private readonly logger = new Logger(CrashEngine.name);
  private current!: Round;
  private history: { bustPoint: number; roundId: string }[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CrashGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.startNewRound();
  }

  // ---------- Public API consumed by CrashService ----------

  snapshot() {
    return {
      roundId: this.current.id,
      phase: this.current.phase,
      startedAt: this.current.startedAt,
      serverSeedHash: this.current.serverSeedHash,
      bustPoint: this.current.phase === 'busted' ? this.current.bustPoint : null,
      multiplier: this.currentMultiplier(),
      bets: Array.from(this.current.bets.values()).map((b) => ({
        userId: b.userId,
        username: b.username,
        walletAddress: b.walletAddress,
        amountLamports: b.amountLamports.toString(),
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
      autoCashout: params.autoCashout,
      cashedOutAt: null,
    });
    this.gateway.emitBetPlaced(this.current.id, params);
    return { ok: true, roundId: this.current.id };
  }

  cashOut(userId: string): { payoutLamports: bigint; multiplier: number } {
    if (this.current.phase !== 'running') {
      throw new Error('Cash out only allowed while running');
    }
    const bet = this.current.bets.get(userId);
    if (!bet) throw new Error('No bet to cash out');
    if (bet.cashedOutAt !== null) throw new Error('Already cashed out');

    const m = this.currentMultiplier();
    if (m >= this.current.bustPoint) throw new Error('Too late — round already busting');

    bet.cashedOutAt = m;
    const payout = (bet.amountLamports * BigInt(Math.floor(m * 100))) / BigInt(100);
    this.gateway.emitCashedOut(this.current.id, {
      userId,
      multiplier: m,
      payoutLamports: payout.toString(),
    });
    return { payoutLamports: payout, multiplier: m };
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
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const nonce = 0;
    const bustPoint = crashPoint(serverSeed, clientSeed, nonce);

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
    };

    this.gateway.emitRoundStart({
      roundId: this.current.id,
      phase: 'waiting',
      serverSeedHash: seed.serverSeedHash,
      bettingWindowMs: CRASH.BET_WINDOW_MS,
    });

    // Betting window → run
    setTimeout(() => {
      void this.beginRun();
    }, CRASH.BET_WINDOW_MS);
  }

  private async beginRun(): Promise<void> {
    this.current.phase = 'running';
    this.current.startedAt = Date.now();
    await this.prisma.crashRound.update({
      where: { id: this.current.id },
      data: { status: 'running', startedAt: new Date(this.current.startedAt) },
    });
    this.gateway.emitRunning(this.current.id, this.current.bustPoint);

    // Tick loop at 20 Hz — server authoritative
    const tickInterval = 1000 / CRASH.TICK_RATE_HZ;
    const tick = () => {
      const m = this.currentMultiplier();

      // Auto-cashouts
      for (const bet of this.current.bets.values()) {
        if (bet.cashedOutAt === null && bet.autoCashout !== null && m >= bet.autoCashout) {
          try {
            this.cashOut(bet.userId);
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
      setTimeout(tick, tickInterval);
    };
    setTimeout(tick, tickInterval);
  }

  private async bust(): Promise<void> {
    this.current.phase = 'busted';
    const bustM = this.current.bustPoint;
    this.history.unshift({ bustPoint: bustM, roundId: this.current.id });
    this.history = this.history.slice(0, 50);

    await this.prisma.crashRound.update({
      where: { id: this.current.id },
      data: {
        status: 'busted',
        bustMultiplier: bustM,
        endedAt: new Date(),
      },
    });
    await this.prisma.seed.update({
      where: { id: this.current.seedId },
      data: { revealedAt: new Date() },
    });

    // Settle the ledger for all bets
    await this.settleRound();

    this.gateway.emitBust({
      roundId: this.current.id,
      bustPoint: bustM,
      serverSeed: this.current.serverSeed,
    });

    // Short gap then next round
    setTimeout(() => {
      void this.startNewRound();
    }, 3_000);
  }

  private async settleRound(): Promise<void> {
    const ops: Promise<unknown>[] = [];
    for (const bet of this.current.bets.values()) {
      const won = bet.cashedOutAt !== null;
      const payout = won
        ? (bet.amountLamports * BigInt(Math.floor(bet.cashedOutAt! * 100))) / BigInt(100)
        : BigInt(0);
      const netProfit = won ? payout - bet.amountLamports : -bet.amountLamports;

      ops.push(
        this.prisma.user.update({
          where: { id: bet.userId },
          data: {
            playBalanceLamports: { increment: won ? payout : BigInt(0) },
            totalWagered: { increment: bet.amountLamports },
            totalWon: { increment: won ? netProfit : BigInt(0) },
            totalLost: { increment: !won ? bet.amountLamports : BigInt(0) },
            gamesPlayed: { increment: 1 },
          },
        }),
      );

      ops.push(
        this.prisma.crashBet.create({
          data: {
            roundId: this.current.id,
            userId: bet.userId,
            amountLamports: bet.amountLamports,
            autoCashoutMultiplier: bet.autoCashout,
            cashoutMultiplier: bet.cashedOutAt,
            payoutLamports: payout,
            won,
          },
        }),
      );

      ops.push(
        this.prisma.bet.create({
          data: {
            userId: bet.userId,
            gameType: 'crash',
            amountLamports: bet.amountLamports,
            payoutLamports: payout,
            multiplier: bet.cashedOutAt ?? this.current.bustPoint,
            status: won ? 'won' : 'lost',
            seedId: this.current.seedId,
            nonce: this.current.nonce,
            resultJson: {
              bustPoint: this.current.bustPoint,
              cashedOutAt: bet.cashedOutAt,
            },
          },
        }),
      );
    }
    try {
      await Promise.all(ops);
    } catch (e) {
      this.logger.error('Failed to settle crash round', e);
    }
  }
}
