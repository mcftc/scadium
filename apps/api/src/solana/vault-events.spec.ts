import { describe, it, expect } from 'vitest';
import { eventDiscriminator, programScopedEventPayloads } from './vault-events';

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

/** How many `name` events `programId` emitted, per the scoped payloads. */
const count = (logs: readonly string[] | null, name: 'Deposited' | 'Withdrawn', programId: string | null) =>
  programScopedEventPayloads(logs, programId).filter((p) =>
    p.subarray(0, 8).equals(eventDiscriminator(name)),
  ).length;

describe('program-scoped event payloads (#H5a)', () => {
  it('returns the data line our program emitted, with its discriminator', () => {
    const logs = framed(VAULT, 'Program log: x', eventData('Deposited', 7, 500_000_000n, 501_002_240n));
    const [payload] = programScopedEventPayloads(logs, VAULT);
    expect(payload!.readBigUInt64LE(40)).toBe(500_000_000n);
    expect(count(logs, 'Deposited', VAULT)).toBe(1);
    expect(count(logs, 'Withdrawn', VAULT)).toBe(0);
  });

  it('REJECTS a forged event emitted by a look-alike program', () => {
    // Same discriminator + payload, but emitted inside the IMPOSTER's frame.
    const forged = framed(IMPOSTER, eventData('Deposited', 7, 999_000_000n, 999_000_000n));
    expect(count(forged, 'Deposited', VAULT)).toBe(0);
    const genuine = framed(VAULT, eventData('Deposited', 7, 999_000_000n, 999_000_000n));
    expect(count(genuine, 'Deposited', VAULT)).toBe(1);
  });

  it('rejects a data line at the top level (no invoke frame → no active program)', () => {
    expect(count([eventData('Deposited', 7, 1n, 1n)], 'Deposited', VAULT)).toBe(0);
  });

  it('scopes correctly across a CPI: an inner impostor invoke does not leak into our frame', () => {
    const logs = [
      `Program ${VAULT} invoke [1]`,
      `Program ${IMPOSTER} invoke [2]`,
      eventData('Deposited', 7, 42n, 42n),
      `Program ${IMPOSTER} success`,
      `Program ${VAULT} success`,
    ];
    expect(count(logs, 'Deposited', VAULT)).toBe(0);
  });

  it('ignores missing/empty logs and a null programId', () => {
    expect(count(null, 'Deposited', VAULT)).toBe(0);
    expect(count([], 'Deposited', VAULT)).toBe(0);
    expect(count(framed(VAULT, eventData('Deposited', 7, 1n, 1n)), 'Deposited', null)).toBe(0);
  });

  it('returns only the target program’s data lines', () => {
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
