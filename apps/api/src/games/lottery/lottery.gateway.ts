import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

/**
 * Realtime channel for the lottery. Browser side subscribes via
 * `useSocket('/lottery')`. Mirrors the crash gateway: a thin broadcaster the
 * engine calls — it holds no game state of its own.
 */
@WebSocketGateway({
  namespace: '/lottery',
  cors: { origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true },
})
export class LotteryGateway {
  @WebSocketServer()
  server!: Server;

  emitDrawOpen(payload: {
    drawId: string;
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
    drawAt: number;
  }) {
    this.server.emit('lottery:draw-open', payload);
  }

  emitTicketSold(payload: {
    drawId: string;
    ticketCount: number;
    potLamports: string;
    totalPoolScadBase: string;
  }) {
    this.server.emit('lottery:ticket-sold', payload);
  }

  emitDrawResult(payload: {
    drawId: string;
    digits: number[];
    serverSeed: string;
    winnersCount: number;
    bracketWinnerCounts: number[];
    burnScadBase: string;
  }) {
    this.server.emit('lottery:draw-result', payload);
  }
}
