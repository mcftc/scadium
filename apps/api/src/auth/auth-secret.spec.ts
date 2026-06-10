import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { jwtModuleOptions } from './auth.module';

/** Minimal ConfigService stub backed by a plain env map. */
const cfg = (env: Record<string, string | undefined>): ConfigService =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

describe('jwtModuleOptions — fail-closed JWT secret (#33)', () => {
  it('throws when JWT_SECRET is unset', () => {
    expect(() => jwtModuleOptions(cfg({}))).toThrow(/JWT_SECRET/);
  });

  it('throws when JWT_SECRET is shorter than 32 bytes', () => {
    expect(() => jwtModuleOptions(cfg({ JWT_SECRET: 'short' }))).toThrow(/JWT_SECRET/);
  });

  it('throws on the old public dev fallback (it is < 32 bytes, no longer accepted)', () => {
    expect(() => jwtModuleOptions(cfg({ JWT_SECRET: 'dev-secret-change-me' }))).toThrow(/32 bytes/);
  });

  it('returns options with the secret when it is ≥ 32 bytes', () => {
    const secret = 'a'.repeat(32);
    const opts = jwtModuleOptions(cfg({ JWT_SECRET: secret }));
    expect(opts.secret).toBe(secret);
    expect(opts.signOptions?.expiresIn).toBe('15m');
  });

  it('honours a JWT_ACCESS_TTL override', () => {
    const opts = jwtModuleOptions(cfg({ JWT_SECRET: 'a'.repeat(40), JWT_ACCESS_TTL: '1h' }));
    expect(opts.signOptions?.expiresIn).toBe('1h');
  });
});
