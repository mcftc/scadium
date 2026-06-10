import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions, Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';

/**
 * Socket.io adapter backed by Redis pub/sub (issue #13/#87). With leader election
 * (#85/#86) only ONE replica drives each game loop and emits, but its clients may
 * be connected to ANY pod. The Redis adapter fans every `server.emit()` out across
 * all pods, so a tick/bust/jackpot broadcast from the leader reaches clients on
 * non-leader pods too. The gateways are unchanged — they still emit via
 * `this.server`; this just swaps the in-memory adapter for the Redis one.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(url: string): Promise<void> {
    const pubClient = new IORedis(url, { maxRetriesPerRequest: null });
    const subClient = pubClient.duplicate();
    // Don't let a Redis blip crash the process — log and keep serving.
    pubClient.on('error', (e) => this.logger.error(`redis pub error: ${e.message}`));
    subClient.on('error', (e) => this.logger.error(`redis sub error: ${e.message}`));
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('Socket.io Redis adapter connected — cross-pod broadcast enabled');
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
