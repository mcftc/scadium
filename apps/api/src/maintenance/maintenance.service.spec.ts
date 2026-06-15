import { describe, it, expect } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';

/** Minimal in-memory stand-in for RedisService.client. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    client: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => void store.set(k, v),
      del: async (k: string) => void store.delete(k),
    },
  };
}

describe('MaintenanceService', () => {
  it('defaults to not paused', async () => {
    const svc = new MaintenanceService(fakeRedis() as never);
    expect(await svc.isPaused()).toBe(false);
  });

  it('reflects the pause flag after setPaused(true) / (false)', async () => {
    const svc = new MaintenanceService(fakeRedis() as never);
    await svc.setPaused(true);
    expect(await svc.isPaused()).toBe(true);
    await svc.setPaused(false);
    expect(await svc.isPaused()).toBe(false);
  });

  it('fails open (not paused) when Redis throws on read', async () => {
    const broken = {
      client: {
        get: async () => {
          throw new Error('redis down');
        },
      },
    };
    const svc = new MaintenanceService(broken as never);
    expect(await svc.isPaused()).toBe(false);
  });

  it('fails LOUD (throws 503) when Redis throws on write', async () => {
    const broken = {
      client: {
        set: async () => {
          throw new Error('redis down');
        },
        del: async () => {
          throw new Error('redis down');
        },
      },
    };
    const svc = new MaintenanceService(broken as never);
    await expect(svc.setPaused(true)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(svc.setPaused(false)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
