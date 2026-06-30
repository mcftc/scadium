import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import type { Card } from '@scadium/shared';
import { resolveCorsOrigins } from '../../config/cors';

/**
 * Realtime channel for the multiplayer blackjack tables. Browser subscribes
 * via `useSocket('/blackjack')`. Thin broadcaster — the engine owns all
 * state. `bj:table` carries the full snapshot so a client can rebuild from
 * any single event; `bj:card` / `bj:turn` are fine-grained cues that drive
 * the deal/reveal animations and the turn countdown.
 */
@WebSocketGateway({
  namespace: '/blackjack',
  cors: { origin: resolveCorsOrigins(process.env.CORS_ORIGIN), credentials: true },
})
export class BlackjackGateway {
  @WebSocketServer()
  server!: Server;

  emitTable(tableId: string, snapshot: unknown) {
    this.server.emit('bj:table', { tableId, snapshot });
  }

  emitCard(
    tableId: string,
    payload: { seatIndex: number | 'dealer'; card: Card | null; hidden: boolean },
  ) {
    this.server.emit('bj:card', { tableId, ...payload });
  }

  emitTurn(tableId: string, payload: { seatIndex: number; deadline: number }) {
    this.server.emit('bj:turn', { tableId, ...payload });
  }

  emitResults(
    tableId: string,
    results: { seatIndex: number; result: string | null; payoutLamports: string }[],
  ) {
    this.server.emit('bj:results', { tableId, results });
  }
}
