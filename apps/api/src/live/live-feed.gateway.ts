import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { resolveCorsOrigins } from '../config/cors';
import type { LiveBetEvent } from './live-feed.types';

/**
 * Sitewide live-bet feed socket (#roadmap-4). A single room-less firehose on the
 * `/live` namespace: every connected client receives every settled bet across
 * all 12 games. Read-only + public (no auth) — the payload is already PII-safe
 * (display handle + amounts, never the full wallet or userId). Clients seed the
 * initial list from `GET /api/v1/live/bets`, then prepend `live:bet` events.
 */
@WebSocketGateway({
  cors: {
    origin: resolveCorsOrigins(process.env.CORS_ORIGIN),
    credentials: true,
  },
  namespace: '/live',
})
export class LiveFeedGateway {
  @WebSocketServer()
  server!: Server;

  broadcast(event: LiveBetEvent): void {
    // `server` is undefined until the gateway is attached to the HTTP server;
    // guard so an early producer (e.g. crash-round recovery on boot) can't throw.
    this.server?.emit('live:bet', event);
  }
}
