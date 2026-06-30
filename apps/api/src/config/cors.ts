/**
 * CORS origin allowlist — the single source of truth for "which browser origins
 * may call this API". Pure + unit-tested so production CORS can never silently
 * regress.
 *
 * Why this exists (the prod wallet outage): the live API runs on Render and the
 * web on Vercel (https://scadium.com). When the Render service had no
 * `CORS_ORIGIN` set, `main.ts` fell back to localhost-only, so the browser
 * blocked EVERY request from https://scadium.com at the preflight ("No
 * 'Access-Control-Allow-Origin' header") — including `POST /auth/nonce`, which is
 * the first call of the wallet sign-in flow. The wallet modal then showed
 * "Connection failed / Failed to fetch", with nothing to do with the wallet's
 * Solana cluster. To make that impossible, the canonical scadium.com domain is
 * ALWAYS allowed here regardless of the env var; explicit `CORS_ORIGIN` entries
 * are merged on top (e.g. a staging origin).
 */

/**
 * Any https origin on the scadium.com apex or one of its subdomains
 * (www / app / a Vercel custom-domain preview). Scoped to https + the exact
 * registrable domain so it can't be widened by a lookalike host.
 */
export const SCADIUM_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?scadium\.com$/;

/** Local dev origins — the Next.js dev server and its 127.0.0.1 alias. */
export const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'] as const;

/**
 * Build the `origin` value for `app.enableCors`. Returns explicit dev origins +
 * any comma-separated `CORS_ORIGIN` entries (deduped), plus the scadium.com
 * regex. With `credentials: true` the `cors` package reflects whichever entry
 * matches the request's Origin.
 */
export function resolveCorsOrigins(corsOriginEnv?: string | null): (string | RegExp)[] {
  const fromEnv = (corsOriginEnv ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const strings = Array.from(new Set<string>([...DEV_ORIGINS, ...fromEnv]));
  return [...strings, SCADIUM_ORIGIN_RE];
}
