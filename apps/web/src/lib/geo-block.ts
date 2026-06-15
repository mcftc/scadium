import { BLOCKED_COUNTRIES } from '@scadium/shared';

/** Game + wallet route prefixes gated by the edge geo-block (#43). */
export const GEO_GATED_PREFIXES = [
  '/crash',
  '/coinflip',
  '/blackjack',
  '/jackpot',
  '/lottery',
  '/wallet',
];

/** True when the resolved country is in the shared blocklist (case-insensitive). */
export function isBlockedCountry(country: string | null | undefined): boolean {
  if (!country) return false;
  return (BLOCKED_COUNTRIES as readonly string[]).includes(country.toUpperCase());
}
