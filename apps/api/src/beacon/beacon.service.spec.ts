import { describe, it, expect, vi, afterEach } from 'vitest';
import { FAIR_BEACON, beaconRoundAfter } from '@scadium/shared';
import { BeaconService } from './beacon.service';

const HEX = 'a'.repeat(64);
const PAST_ROUND = beaconRoundAfter(Date.now() - 60_000); // long published

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('BeaconService (ADR 0004)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FAIR_BEACON_WAIT_MS;
    delete process.env.FAIR_BEACON_RELAYS;
    delete process.env.FAIR_BEACON_ENABLED;
  });

  it('is on unless explicitly disabled', () => {
    const svc = new BeaconService();
    expect(svc.enabled).toBe(true);
    process.env.FAIR_BEACON_ENABLED = 'false';
    expect(svc.enabled).toBe(false);
  });

  it('returns the round from the first relay that answers correctly', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503)) // relay down
      .mockResolvedValueOnce(jsonResponse({ round: PAST_ROUND + 1, randomness: HEX })) // wrong round
      .mockResolvedValueOnce(jsonResponse({ round: PAST_ROUND, randomness: 'not-hex' })) // malformed
      .mockResolvedValueOnce(jsonResponse({ round: PAST_ROUND, randomness: HEX }));
    vi.stubGlobal('fetch', fetch);
    await expect(new BeaconService().randomness(PAST_ROUND)).resolves.toBe(HEX);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(String(fetch.mock.calls[0]![0])).toContain(`/${FAIR_BEACON.CHAIN_HASH}/public/${PAST_ROUND}`);
  });

  it('gives up with null — never a made-up value — when no relay answers in time', async () => {
    process.env.FAIR_BEACON_WAIT_MS = '300';
    process.env.FAIR_BEACON_RELAYS = 'https://relay.invalid';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(new BeaconService().randomness(PAST_ROUND)).resolves.toBeNull();
  });
});
