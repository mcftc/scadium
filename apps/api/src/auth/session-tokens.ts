import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Pure session-token helpers (#35) — no DB, no Nest, so they unit-test cleanly.
 * The access token carries a `jti` bound to a Session row; the refresh token is
 * an opaque high-entropy string whose SHA-256 (never the raw value) is stored.
 */

/** A fresh JWT id (jti) binding an access token to its session. */
export function newJti(): string {
  return randomUUID();
}

/** A high-entropy opaque refresh token — returned to the client raw exactly once. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex of a refresh token. Only the hash is ever persisted/compared. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const TTL_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parse a `JWT_REFRESH_TTL` string (`7d` / `12h` / `30m` / `3600s`) to ms. */
export function parseTtlMs(ttl: string | undefined, fallbackMs = 7 * TTL_UNIT_MS.d!): number {
  if (!ttl) return fallbackMs;
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) return fallbackMs;
  return Number(m[1]) * TTL_UNIT_MS[m[2]!]!;
}
