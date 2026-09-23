import { describe, it, expect } from 'vitest';
import { isValidBetSol, parseSolToLamports, solToLamportsClamped } from './bet-amount-input';

describe('exact SOL → lamports', () => {
  it('parses decimal strings without float error', () => {
    // Number('0.3') * 1e9 = 299999999.99999997 — the float path placed it 1 short.
    expect(parseSolToLamports('0.3')).toBe(300_000_000n);
    expect(parseSolToLamports('0.1')).toBe(100_000_000n);
    expect(parseSolToLamports('1.000000001')).toBe(1_000_000_001n);
    expect(parseSolToLamports('12')).toBe(12_000_000_000n);
    expect(parseSolToLamports('.5')).toBe(500_000_000n);
  });

  it('truncates past 9 decimals and rejects non-decimals', () => {
    expect(parseSolToLamports('0.0000000019')).toBe(1n);
    expect(parseSolToLamports('')).toBeNull();
    expect(parseSolToLamports('-1')).toBeNull();
    expect(parseSolToLamports('abc')).toBeNull();
    expect(parseSolToLamports('1e-3')).toBeNull();
  });

  it('validates and clamps through the exact parser', () => {
    expect(solToLamportsClamped('0.3', 1_000_000, 100_000_000_000)).toBe('300000000');
    expect(solToLamportsClamped('0', 1_000_000, 100)).toBe('1000000');
    expect(solToLamportsClamped('500', 1, 100_000_000_000)).toBe('100000000000');
    expect(isValidBetSol('0.001', 1_000_000)).toBe(true);
    expect(isValidBetSol('0.0009', 1_000_000)).toBe(false);
    expect(isValidBetSol('', 1)).toBe(false);
  });
});
