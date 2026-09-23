import { describe, it, expect } from 'vitest';
import { FAIR_BEACON, beaconRoundAfter, beaconRoundTimeMs, beaconRoundUrl } from '@scadium/shared';

describe('drand beacon round maths (ADR 0004)', () => {
  it('round 1 is published at genesis, then one round per period', () => {
    expect(beaconRoundTimeMs(1)).toBe(FAIR_BEACON.GENESIS_TIME_SEC * 1000);
    expect(beaconRoundTimeMs(11) - beaconRoundTimeMs(10)).toBe(FAIR_BEACON.PERIOD_SEC * 1000);
  });

  it('roundAfter(t) is the first round published STRICTLY after t', () => {
    for (const t of [
      beaconRoundTimeMs(1_000),
      beaconRoundTimeMs(1_000) + 1,
      beaconRoundTimeMs(1_000) - 1,
      beaconRoundTimeMs(32_459_457) + 1_500,
      Date.UTC(2026, 8, 23, 9, 0, 0),
    ]) {
      const r = beaconRoundAfter(t);
      expect(beaconRoundTimeMs(r)).toBeGreaterThan(t); // unknowable at t…
      expect(beaconRoundTimeMs(r - 1)).toBeLessThanOrEqual(t); // …and the earliest such round
    }
  });

  it('builds a relay URL for a round', () => {
    expect(beaconRoundUrl(42, 'https://api.drand.sh/')).toBe(
      `https://api.drand.sh/${FAIR_BEACON.CHAIN_HASH}/public/42`,
    );
  });
});
