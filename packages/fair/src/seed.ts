import { randomBytes } from 'node:crypto';
import { sha256 } from './hash';

/**
 * Generate a cryptographically-secure random server seed (64 hex chars = 256 bits).
 */
export function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate a random default client seed. Players can override this.
 */
export function generateClientSeed(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Commit to a server seed by publishing its SHA-256 hash before the round.
 * Revealing the preimage after settlement proves it was not tampered with.
 */
export function commitServerSeed(serverSeed: string): string {
  return sha256(serverSeed);
}
