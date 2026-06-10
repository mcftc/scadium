import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';

/**
 * Issue #87 — the Redis adapter must fan a broadcast emitted on ONE Socket.io
 * server out to clients connected to ANOTHER server (the cross-pod path leader
 * election relies on: only the leader emits, but clients hang off any pod). Two
 * servers share Redis pub/sub; a client on server B receives an emit from A.
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

type Instance = { io: Server; http: HttpServer; port: number; pub: IORedis; sub: IORedis };

async function makeInstance(): Promise<Instance> {
  const pub = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const sub = pub.duplicate();
  const http = createServer();
  const io = new Server(http);
  io.adapter(createAdapter(pub, sub));
  await new Promise<void>((r) => http.listen(0, r));
  const port = (http.address() as AddressInfo).port;
  return { io, http, port, pub, sub };
}

describe('Socket.io Redis adapter cross-pod broadcast (issue #87)', () => {
  let a: Instance;
  let b: Instance;
  let client: ClientSocket;

  afterAll(async () => {
    client?.disconnect();
    await Promise.all([a, b].map((i) => (i ? i.io.close() : undefined)));
    [a, b].forEach((i) => i?.http.close());
    await Promise.all([a?.pub, a?.sub, b?.pub, b?.sub].map((c) => c?.quit().catch(() => undefined)));
  });

  it('a broadcast from instance A reaches a client connected to instance B', async () => {
    a = await makeInstance();
    b = await makeInstance();

    // Client connects to instance B.
    client = Client(`http://localhost:${b.port}`, { transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => resolve());
      client.on('connect_error', reject);
      setTimeout(() => reject(new Error('client connect timeout')), 5_000);
    });

    const received = new Promise<{ tick: number }>((resolve, reject) => {
      client.on('crash:tick', (p: { tick: number }) => resolve(p));
      setTimeout(() => reject(new Error('did not receive cross-pod broadcast')), 5_000);
    });

    // Emit from instance A (a DIFFERENT server than the client is on). Give the
    // Redis pub/sub a moment to register the subscription first.
    await new Promise((r) => setTimeout(r, 300));
    a.io.emit('crash:tick', { tick: 42 });

    expect((await received).tick).toBe(42);
  });
});
