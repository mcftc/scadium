import { Injectable, Logger } from '@nestjs/common';
import { FAIR_BEACON, beaconRoundAfter, beaconRoundTimeMs, beaconRoundUrl } from '@scadium/shared';

/** Read an integer env var > 0, falling back when absent/invalid. */
function envMs(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * The public randomness beacon (drand quicknet — ADR 0004) as the games use it.
 * A game pins `roundAfter(closeTime)` — the first beacon round published after
 * bets/entries/sales close — and folds that round's randomness into its result,
 * so neither the operator nor anyone else can know a result while it can still
 * be bet on.
 *
 * Settings (all optional):
 *  - FAIR_BEACON_ENABLED (default on): "false" falls back to the older
 *    seed-only derivation — the integration suite sets it, since it must not
 *    depend on the internet; production keeps it on.
 *  - FAIR_BEACON_RELAYS: comma-separated relay base URLs (default FAIR_BEACON.RELAYS).
 *  - FAIR_BEACON_WAIT_MS (default 15s): how long past a round's publish time to
 *    keep trying before giving up (crash then voids and refunds the round; the
 *    jackpot and lottery settles retry).
 *  - FAIR_BEACON_RELAY_TIMEOUT_MS (default 2.5s): per-request timeout.
 */
@Injectable()
export class BeaconService {
  private readonly logger = new Logger(BeaconService.name);

  get enabled(): boolean {
    return (process.env.FAIR_BEACON_ENABLED ?? 'true') !== 'false';
  }

  /** The first beacon round published strictly after `ms`. */
  roundAfter(ms: number): number {
    return beaconRoundAfter(ms);
  }

  /**
   * Randomness (64 hex) of `round`: waits for it to be published, then asks
   * each relay in turn until one answers or FAIR_BEACON_WAIT_MS past its publish
   * time has elapsed. Null on timeout — callers never fall back to a value the
   * operator could know.
   */
  async randomness(round: number): Promise<string | null> {
    const due = beaconRoundTimeMs(round);
    const deadline = Math.max(Date.now(), due) + envMs('FAIR_BEACON_WAIT_MS', 15_000);
    // A round appears a moment after its nominal time; don't ask before then.
    if (due > Date.now()) await sleep(due - Date.now() + 200);
    while (Date.now() < deadline) {
      for (const relay of this.relays()) {
        const value = await this.fetchRound(relay, round);
        if (value) return value;
      }
      await sleep(Math.min(500, deadline - Date.now()));
    }
    this.logger.error(`beacon round ${round}: no relay answered in time`);
    return null;
  }

  private relays(): readonly string[] {
    const override = process.env.FAIR_BEACON_RELAYS?.split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    return override?.length ? override : FAIR_BEACON.RELAYS;
  }

  private async fetchRound(relay: string, round: number): Promise<string | null> {
    try {
      const res = await fetch(beaconRoundUrl(round, relay), {
        signal: AbortSignal.timeout(envMs('FAIR_BEACON_RELAY_TIMEOUT_MS', 2_500)),
      });
      if (!res.ok) return null; // not published yet, or a bad relay
      const body = (await res.json()) as { round?: number; randomness?: string };
      // Only the exact round asked for, as 32 bytes of hex — anything else is a
      // relay fault, not entropy.
      if (body.round !== round || !/^[0-9a-f]{64}$/.test(body.randomness ?? '')) return null;
      return body.randomness!;
    } catch {
      return null;
    }
  }
}
