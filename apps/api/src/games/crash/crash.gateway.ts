import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { resolveCorsOrigins } from '../../config/cors';

/**
 * Broadcasts crash round lifecycle events. Clients get a room-less
 * firehose — every connected socket receives every tick. For scale we'd
 * aggregate ticks server-side and batch-emit, but at 20 Hz with <1k
 * concurrent viewers a single emit per tick is fine.
 */
@WebSocketGateway({
  cors: {
    origin: resolveCorsOrigins(process.env.CORS_ORIGIN),
    credentials: true,
  },
  namespace: '/crash',
})
export class CrashGateway {
  @WebSocketServer()
  server!: Server;

  emitRoundStart(payload: {
    roundId: string;
    phase: 'waiting';
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
    bettingWindowMs: number;
  }) {
    this.server.emit('crash:round-start', payload);
  }

  emitRunning(roundId: string) {
    // The bust point is intentionally NOT part of this payload — it must
    // stay secret until the round resolves.
    this.server.emit('crash:running', { roundId });
  }

  emitTick(roundId: string, multiplier: number) {
    this.server.emit('crash:tick', { roundId, multiplier });
  }

  emitBust(payload: { roundId: string; bustPoint: number; serverSeed: string }) {
    this.server.emit('crash:bust', payload);
  }

  emitBetPlaced(roundId: string, bet: {
    userId: string;
    username: string | null;
    walletAddress: string;
    amountLamports: bigint;
    autoCashout: number | null;
  }) {
    this.server.emit('crash:bet-placed', {
      roundId,
      userId: bet.userId,
      username: bet.username,
      walletAddress: bet.walletAddress,
      amountLamports: bet.amountLamports.toString(),
      autoCashout: bet.autoCashout,
      // A fresh bet is never cashed out. The web CrashBet type expects
      // `number | null` — omitting the field delivers undefined and breaks
      // the players list's cashed-out check.
      cashedOutAt: null,
    });
  }

  emitCashedOut(roundId: string, payload: {
    userId: string;
    /** Name fields so the curve can label the cashout marker. */
    username: string | null;
    walletAddress: string;
    multiplier: number;
    payoutLamports: string;
    /** Stake still riding after this (possibly partial) cashout. */
    remainingLamports: string;
  }) {
    this.server.emit('crash:cashed-out', { roundId, ...payload });
  }
}
