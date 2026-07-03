import { floatsFromHmac } from './floats';

/**
 * Dice roll in [0, 100) with 2-decimal precision, derived from one uniform
 * float. The service decides win/lose: for a roll-under target T the player
 * wins when `roll < T` (multiplier `(100 - edge%) / T`); for roll-over the
 * player wins when `roll >= T` (multiplier `(100 - edge%) / (100 - T)`). The
 * two rules split the 10,000-outcome grid exactly, so the derivation itself
 * is mode-agnostic.
 */
export function diceRoll(serverSeed: string, clientSeed: string, nonce: number): number {
  const [u] = floatsFromHmac(serverSeed, clientSeed, nonce, 1);
  return Math.floor(u! * 10000) / 100; // 0.00 .. 99.99
}
