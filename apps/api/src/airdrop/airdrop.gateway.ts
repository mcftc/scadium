import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

/**
 * Realtime channel for the hourly airdrop pool (left-rail widget). Browser
 * subscribes via `useSocket('/airdrop')`. Thin broadcaster — the engine
 * owns all state.
 */
@WebSocketGateway({
  namespace: '/airdrop',
  cors: { origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true },
})
export class AirdropGateway {
  @WebSocketServer()
  server!: Server;

  /** Pool grew (base seeded or a tip landed). */
  emitPool(payload: { poolLamports: string; endsAt: number; tipsCount: number }) {
    this.server.emit('airdrop:pool', payload);
  }

  /** Hourly distribution settled. */
  emitDropped(payload: {
    totalLamports: string;
    participantCount: number;
    perUserLamports: string;
  }) {
    this.server.emit('airdrop:dropped', payload);
  }
}
