import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

/**
 * Realtime chat gateway. Clients connect to `/chat`, optionally with a
 * `token` auth payload; unauthenticated sockets can read but can't post.
 *
 * The gateway never inspects message bodies itself — all validation,
 * rate limiting, and profanity filtering live in ChatService, so the
 * same rules apply to any future REST-based posting path.
 */
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const raw = client.handshake.auth?.token as string | undefined;
    if (raw) {
      try {
        const payload = await this.jwt.verifyAsync<{ userId: string; walletAddress: string }>(raw);
        client.data.userId = payload.userId;
        client.data.walletAddress = payload.walletAddress;
      } catch {
        // Stay connected but unauthenticated — read-only mode.
      }
    }

    // Send recent history on connect
    const recent = await this.chat.listRecent(50);
    client.emit('chat:history', recent);
  }

  @SubscribeMessage('chat:send')
  async handleSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { body: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      client.emit('chat:error', { message: 'Sign in to send messages' });
      return;
    }
    try {
      const msg = await this.chat.post({ userId, body: payload.body });
      this.server.emit('chat:message', msg);
    } catch (e) {
      client.emit('chat:error', {
        message: e instanceof Error ? e.message : 'Failed to send',
      });
    }
  }
}
