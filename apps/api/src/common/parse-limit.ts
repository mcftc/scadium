/**
 * Safely parse a `?limit` query param into a bounded positive integer.
 *
 * Controllers previously did `limit ? Number(limit) : default`, so a
 * non-numeric (`?limit=abc` → NaN) or fractional (`?limit=1.5`) value flowed
 * into Prisma's `take` — NaN propagates through the services' `Math.min/max`
 * clamp and reaches the driver as an invalid `take` (a minor DoS / 500 vector).
 * This normalizes: undefined/blank/NaN → `fallback`, then truncate and clamp
 * to `[1, max]`.
 */
export function parseLimit(raw: string | undefined, fallback: number, max = 100): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}
