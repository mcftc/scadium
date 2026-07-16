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
 * Decode the base64 payloads of `Program data:` lines that were emitted while
 * `programId` is the ACTIVE invoke frame — never trusting a `Program data:`
 * line emitted by some OTHER program in the same transaction (#H5/#H5a). Solana
 * logs bracket each program's execution as `Program <id> invoke [depth]` …
 * `Program <id> success|failed`, and CPIs nest, so we track the invoke stack and
 * only accept a data line whose top-of-stack program equals `programId`.
 *
 * Without this scoping, a look-alike program could emit a forged event with the
 * right discriminator and be trusted as if it came from our program.
 */
export function programScopedEventPayloads(
  logMessages: readonly string[] | null | undefined,
  programId: string | null | undefined,
): Buffer[] {
  const out: Buffer[] = [];
  if (!logMessages || !programId) return out;
  const stack: string[] = [];
  for (const line of logMessages) {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program \S+ (?:success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (!line.startsWith('Program data: ')) continue;
    if (stack[stack.length - 1] !== programId) continue; // wrong emitter — ignore
    try {
      out.push(Buffer.from(line.slice('Program data: '.length), 'base64'));
    } catch {
      /* skip malformed base64 */
    }
  }
  return out;
}

/**
 * Find and decode the first `Deposited`/`Withdrawn` event that OUR vault program
 * (`programId`) emitted in a confirmed transaction's logs. Returns null when the
 * logs carry no such event from our program (wrong/forged emitter, failed tx,
 * unrelated data).
 */
export function parseVaultEvent(
  logMessages: readonly string[] | null | undefined,
  name: 'Deposited' | 'Withdrawn',
  programId: string | null | undefined,
): VaultEvent | null {
  const disc = eventDiscriminator(name);
  for (const payload of programScopedEventPayloads(logMessages, programId)) {
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
