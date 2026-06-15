import { describe, it, expect } from 'vitest';
import { coversReserve, reserveFloorLamports } from './treasury-guard';
import { metricsRegistry } from '../observability/metrics.registry';

const SOL = 1_000_000_000n;

describe('treasury solvency guard (#54)', () => {
  it('reserveFloorLamports = rent floor + buffer', () => {
    expect(reserveFloorLamports(890_880n, SOL)).toBe(890_880n + SOL);
  });

  it('a loss or zero net (house gains) always covers', () => {
    expect(coversReserve(0n, 0n, SOL)).toBe(true);
    expect(coversReserve(0n, -5n * SOL, SOL)).toBe(true);
  });

  it('allows a payout that leaves the house at or above the floor', () => {
    // balance 10, pay net 4, floor 5 → 6 left ≥ 5 → ok. Boundary: leaves exactly floor.
    expect(coversReserve(10n * SOL, 4n * SOL, 5n * SOL)).toBe(true);
    expect(coversReserve(10n * SOL, 5n * SOL, 5n * SOL)).toBe(true);
  });

  it('refuses a payout that would drop the house below the floor', () => {
    // balance 10, pay net 6, floor 5 → 4 left < 5 → refuse.
    expect(coversReserve(10n * SOL, 6n * SOL, 5n * SOL)).toBe(false);
  });
});

describe('treasury metrics are registered (#54)', () => {
  it('exposes the payout-blocked and payout-failed counters', async () => {
    const text = await metricsRegistry.metrics();
    expect(text).toContain('scadium_treasury_payout_blocked_total');
    expect(text).toContain('scadium_payout_failed_total');
  });
});
