import { describe, it, expect } from 'vitest';
import { eventDiscriminator, parseVaultEvent } from './vault-events';

/** Build an anchor-style `Program data:` log line for a vault event. */
function eventLog(name: 'Deposited' | 'Withdrawn', userBytes: number, amount: bigint, vaultBalance: bigint): string {
  const buf = Buffer.alloc(8 + 32 + 8 + 8);
  eventDiscriminator(name).copy(buf, 0);
  buf.fill(userBytes, 8, 40);
  buf.writeBigUInt64LE(amount, 40);
  buf.writeBigUInt64LE(vaultBalance, 48);
  return `Program data: ${buf.toString('base64')}`;
}

describe('vault event parsing (#27)', () => {
  it('decodes a Deposited event (user, exact lamports)', () => {
    const log = eventLog('Deposited', 7, 500_000_000n, 501_002_240n);
    const ev = parseVaultEvent(['Program log: x', log], 'Deposited');
    expect(ev).not.toBeNull();
    expect(ev!.amount).toBe(500_000_000n);
    expect(ev!.vaultBalance).toBe(501_002_240n);
    expect(ev!.user.length).toBeGreaterThan(30); // base58 of the 32-byte key
  });

  it('does not cross-match event types (a Withdrawn log is not a deposit)', () => {
    const log = eventLog('Withdrawn', 7, 100n, 0n);
    expect(parseVaultEvent([log], 'Deposited')).toBeNull();
    expect(parseVaultEvent([log], 'Withdrawn')!.amount).toBe(100n);
  });

  it('ignores unrelated/short/garbage program data and missing logs', () => {
    expect(parseVaultEvent(null, 'Deposited')).toBeNull();
    expect(parseVaultEvent([], 'Deposited')).toBeNull();
    expect(parseVaultEvent(['Program data: AAAA'], 'Deposited')).toBeNull();
    expect(parseVaultEvent(['Program log: Instruction: Deposit'], 'Deposited')).toBeNull();
  });
});
