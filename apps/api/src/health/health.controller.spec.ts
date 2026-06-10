import { describe, it, expect, vi } from 'vitest';
import { HealthController } from './health.controller';

function makeController(opts: { dbUp: boolean; redisUp: boolean }) {
  const prisma = {
    $queryRaw: vi.fn(() =>
      opts.dbUp ? Promise.resolve([{ ok: 1 }]) : Promise.reject(new Error('db unreachable')),
    ),
  } as never;
  const redis = { ping: vi.fn(() => Promise.resolve(opts.redisUp)) } as never;
  return { ctrl: new HealthController(prisma, redis), prisma, redis };
}

function mockRes() {
  const r = { status: vi.fn(() => r) } as { status: ReturnType<typeof vi.fn> };
  return r;
}

describe('HealthController (#15 liveness/readiness)', () => {
  it('live(): returns ok and performs NO external I/O', () => {
    const { ctrl, prisma, redis } = makeController({ dbUp: true, redisUp: true });
    const out = ctrl.live();
    expect(out.status).toBe('ok');
    expect(out.service).toBe('scadium-api');
    expect((prisma as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw).not.toHaveBeenCalled();
    expect((redis as { ping: ReturnType<typeof vi.fn> }).ping).not.toHaveBeenCalled();
  });

  it('check(): aliases liveness (backward compat)', () => {
    const { ctrl } = makeController({ dbUp: false, redisUp: false });
    expect(ctrl.check().status).toBe('ok'); // never probes, even with deps down
  });

  it('ready(): 200 when Postgres and Redis both succeed', async () => {
    const { ctrl } = makeController({ dbUp: true, redisUp: true });
    const res = mockRes();
    const out = await ctrl.ready(res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(out).toMatchObject({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('ready(): 503 with `database: down` when Postgres is unreachable', async () => {
    const { ctrl } = makeController({ dbUp: false, redisUp: true });
    const res = mockRes();
    const out = await ctrl.ready(res as never);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(out.status).toBe('unavailable');
    expect(out.checks).toMatchObject({ database: 'down', redis: 'up' });
  });

  it('ready(): 503 with `redis: down` when Redis is unreachable', async () => {
    const { ctrl } = makeController({ dbUp: true, redisUp: false });
    const res = mockRes();
    const out = await ctrl.ready(res as never);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(out.checks).toMatchObject({ database: 'up', redis: 'down' });
  });
});
