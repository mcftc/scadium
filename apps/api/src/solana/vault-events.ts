import { createHash } from 'node:crypto';

/**
 * Anchor event parsing for the vault program (#27) — pure, unit-testable. The
 * deposit/withdraw bridge must not trust client-reported amounts: the credit
 * criteria is the PROGRAM's own emitted event inside the confirmed
 * transaction's logs (`Program data: <base64>`), whose payload is
 * `sha256("event:<Name>")[0..8] ‖ borsh(fields)`.
 *
 * Deposited / Withdrawn share one layout:
 *   user: Pubkey (32) ‖ amount: u64 LE ‖ vault_balance: u64 LE
 */
export interface VaultEvent {
  user: string; // base58
  amount: bigint;
  vaultBalance: bigint;
}

export function eventDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`event:${name}`).digest().subarray(0, 8);
}

// Minimal base58 encode — avoids importing bs58 into this pure module.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(buf: Buffer): string {
  let n = BigInt('0x' + buf.toString('hex'));
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

/**
 * Find and decode the first `Deposited`/`Withdrawn` event in a confirmed
 * transaction's log messages. Returns null when the logs carry no such event
 * (wrong program, failed tx logs, unrelated data).
 */
export function parseVaultEvent(
  logMessages: readonly string[] | null | undefined,
  name: 'Deposited' | 'Withdrawn',
): VaultEvent | null {
  if (!logMessages) return null;
  const disc = eventDiscriminator(name);
  for (const line of logMessages) {
    if (!line.startsWith('Program data: ')) continue;
    let payload: Buffer;
    try {
      payload = Buffer.from(line.slice('Program data: '.length), 'base64');
    } catch {
      continue;
    }
    if (payload.length < 8 + 32 + 8 + 8) continue;
    if (!payload.subarray(0, 8).equals(disc)) continue;
    return {
      user: base58(payload.subarray(8, 40)),
      amount: payload.readBigUInt64LE(40),
      vaultBalance: payload.readBigUInt64LE(48),
    };
  }
  return null;
}
