import { createHmac } from 'node:crypto';

/**
 * How a player appears in anything broadcast to every socket or served to the
 * public: a display handle and an opaque id — never the internal userId or the
 * full wallet address (the live feed's policy, now shared by every game).
 */

/** first4…last4 — enough to recognise a wallet without exposing it. */
export function shortWallet(addr: string): string {
  return addr.length <= 10 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** Username if the player set one, else their shortened wallet. */
export function displayHandle(user: { username: string | null; walletAddress: string }): string {
  return user.username || shortWallet(user.walletAddress);
}

/**
 * Stable, opaque public id for a user: an HMAC of the userId under the server's
 * JWT secret (always configured — the API refuses to boot without it). Clients
 * learn their OWN id from GET /me and compare, so "is this me?" works without
 * any broadcast carrying a real userId. Rotating the secret only re-keys these
 * display ids; nothing is stored against them.
 */
export function publicPlayerId(userId: string): string {
  return createHmac('sha256', process.env.JWT_SECRET ?? '')
    .update(`public-player:${userId}`)
    .digest('hex')
    .slice(0, 16);
}
