import { describe, it, expect } from 'vitest';
import { eventDiscriminator, parseVaultEvent, programScopedEventPayloads } from './vault-events';

const VAULT = 'Vau1t1111111111111111111111111111111111111';
const IMPOSTER = 'Imp0ster1111111111111111111111111111111111';

/** The base64 `Program data:` line for a vault event (discriminator + fields). */
function eventData(
  name: 'Deposited' | 'Withdrawn',
  userBytes: number,
  amount: bigint,
  vaultBalance: bigint,
): string {
  const buf = Buffer.alloc(8 + 32 + 8 + 8);
  eventDiscriminator(name).copy(buf, 0);
  buf.fill(userBytes, 8, 40);
  buf.writeBigUInt64LE(amount, 40);
  buf.writeBigUInt64LE(vaultBalance, 48);
  return `Program data: ${buf.toString('base64')}`;
}

/** Wrap log lines in `program`'s invoke/success frame (how Solana brackets a program's logs). */
const framed = (program: string, ...inner: string[]) => [
  `Program ${program} invoke [1]`,
  ...inner,
  `Program ${program} success`,
];

describe('vault event parsing (#27) — program-scoped (#H5a)', () => {
  it('decodes a Deposited event our vault program emitted', () => {
    const logs = framed(VAULT, 'Program log: x', eventData('Deposited', 7, 500_000_000n, 501_002_240n));
    const ev = parseVaultEvent(logs, 'Deposited', VAULT);
    expect(ev).not.toBeNull();
    expect(ev!.amount).toBe(500_000_000n);
    expect(ev!.vaultBalance).toBe(501_002_240n);
    expect(ev!.user.length).toBeGreaterThan(30);
  });

  it('does not cross-match event types', () => {
    const logs = framed(VAULT, eventData('Withdrawn', 7, 100n, 0n));
    expect(parseVaultEvent(logs, 'Deposited', VAULT)).toBeNull();
    expect(parseVaultEvent(logs, 'Withdrawn', VAULT)!.amount).toBe(100n);
  });

  it('REJECTS a forged event emitted by a look-alike program (#H5a)', () => {
    // Same discriminator + payload, but emitted inside the IMPOSTER's frame.
    const forged = framed(IMPOSTER, eventData('Deposited', 7, 999_000_000n, 999_000_000n));
    expect(parseVaultEvent(forged, 'Deposited', VAULT)).toBeNull();
    // And it IS accepted when it really is our program's frame.
    const genuine = framed(VAULT, eventData('Deposited', 7, 999_000_000n, 999_000_000n));
    expect(parseVaultEvent(genuine, 'Deposited', VAULT)!.amount).toBe(999_000_000n);
  });

  it('rejects a data line at the top level (no invoke frame → no active program)', () => {
    expect(parseVaultEvent([eventData('Deposited', 7, 1n, 1n)], 'Deposited', VAULT)).toBeNull();
  });

  it('scopes correctly across a CPI: an inner impostor invoke does not leak into our frame', () => {
    // Our program invokes, then CPIs into the impostor which emits the forged
    // event; that data line belongs to the impostor (top of stack), not us.
    const logs = [
      `Program ${VAULT} invoke [1]`,
      `Program ${IMPOSTER} invoke [2]`,
      eventData('Deposited', 7, 42n, 42n),
      `Program ${IMPOSTER} success`,
      `Program ${VAULT} success`,
    ];
    expect(parseVaultEvent(logs, 'Deposited', VAULT)).toBeNull();
  });

  it('ignores missing/empty/garbage logs and a null programId', () => {
    expect(parseVaultEvent(null, 'Deposited', VAULT)).toBeNull();
    expect(parseVaultEvent([], 'Deposited', VAULT)).toBeNull();
    expect(parseVaultEvent(framed(VAULT, 'Program data: AAAA'), 'Deposited', VAULT)).toBeNull();
    expect(
      parseVaultEvent(framed(VAULT, eventData('Deposited', 7, 1n, 1n)), 'Deposited', null),
    ).toBeNull();
  });

  it('programScopedEventPayloads returns only the target program’s data lines', () => {
    const logs = [
      `Program ${IMPOSTER} invoke [1]`,
      'Program data: AAAA', // impostor's — excluded
      `Program ${IMPOSTER} success`,
      `Program ${VAULT} invoke [1]`,
      eventData('Deposited', 7, 5n, 5n), // ours — included
      `Program ${VAULT} success`,
    ];
    const payloads = programScopedEventPayloads(logs, VAULT);
    expect(payloads.length).toBe(1);
    expect(payloads[0]!.subarray(0, 8).equals(eventDiscriminator('Deposited'))).toBe(true);
  });
});
