import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server } from 'socket.io';

/**
 * WebSocket gateway for the coinflip lobby. Clients join the `coinflip`
 * room on connect and receive real-time `created`, `resolved`, `cancelled`
 * events as flips move through their state machine.
 *
 * No auth required for viewing — bets still go through the authed REST
 * endpoints which enforce ownership.
 */
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/coinflip',
})
export class CoinflipGateway {
  private readonly logger = new Logger(CoinflipGateway.name);

  @WebSocketServer()
  server!: Server;

  @SubscribeMessage('ping')
  handlePing(): { pong: number } {
    return { pong: Date.now() };
  }

  emitCreated(game: unknown): void {
    this.server.emit('flip:created', game);
  }

  emitResolved(game: unknown): void {
    this.server.emit('flip:resolved', game);
  }

  emitCancelled(payload: { id: string }): void {
    this.server.emit('flip:cancelled', payload);
  }
}
