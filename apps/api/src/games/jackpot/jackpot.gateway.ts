import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { resolveCorsOrigins } from '../../config/cors';

/**
 * Realtime channel for the jackpot. Browser subscribes via
 * `useSocket('/jackpot')`. Thin broadcaster — the engine owns all state.
 */
@WebSocketGateway({
  namespace: '/jackpot',
  cors: { origin: resolveCorsOrigins(process.env.CORS_ORIGIN), credentials: true },
})
export class JackpotGateway {
  @WebSocketServer()
  server!: Server;

  emitRoundOpen(payload: {
    roundId: string;
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
    /** Null: waiting for players — the clock starts with the first entry. */
    closeAt: number | null;
  }) {
    this.server.emit('jackpot:round-open', payload);
  }

  emitEntry(payload: {
    roundId: string;
    userId: string;
    username: string | null;
    walletAddress: string;
    amountLamports: string;
    totalLamports: string;
    playerCount: number;
    /** The round's (possibly just-started) deadline, so clients update without a refetch. */
    closeAt: number | null;
  }) {
    this.server.emit('jackpot:entry', payload);
  }

  emitDrawResult(payload: {
    roundId: string;
    status: 'drawn' | 'refunded';
    winnerId: string | null;
    winnerName: string | null;
    payoutLamports: string;
    totalLamports: string;
    winningTicket: string | null;
    serverSeed: string;
  }) {
    this.server.emit('jackpot:result', payload);
  }
}
