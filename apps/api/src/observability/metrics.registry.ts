import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics (#38). Module-level singletons (not Nest providers) so any
 * code — engines included — can increment a counter via a plain import, without
 * threading a service through constructors (which would break the direct-engine
 * test harness signatures).
 */
export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });

/** HTTP latency histogram — labels match the conventional Grafana dashboards. */
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

/** Settlement outcomes per game — incremented by the engines' settle paths. */
export const settlementsTotal = new Counter({
  name: 'scadium_settlements_total',
  help: 'Game settlements by outcome (settled/refunded/failed)',
  labelNames: ['game', 'outcome'] as const,
  registers: [metricsRegistry],
});

/** Live house bankroll (#30) — set by the solvency monitor each sweep. */
export const houseVaultLamports = new Gauge({
  name: 'scadium_house_vault_lamports',
  help: 'house_vault PDA balance in lamports (the funded bankroll)',
  registers: [metricsRegistry],
});

/** Low-bankroll alerts (#30): house_vault below rent floor + buffer. */
export const lowBankrollAlertsTotal = new Counter({
  name: 'scadium_low_bankroll_alerts_total',
  help: 'Solvency monitor alerts — house vault under rent floor + buffer',
  registers: [metricsRegistry],
});

/** Payouts refused PRE-EMPTIVELY (#54) because paying would drop the house
 *  vault below the documented reserve floor — refused before the program's
 *  own InsufficientFunds check, so the bankroll never silently bottoms out. */
export const treasuryPayoutBlockedTotal = new Counter({
  name: 'scadium_treasury_payout_blocked_total',
  help: 'On-chain payouts refused because they would breach the reserve floor',
  labelNames: ['kind'] as const,
  registers: [metricsRegistry],
});

/** On-chain payouts that returned null (failed / unverified) — the reconcile
 *  backlog (#54). No silent loss: each increment is a payout to retry/sweep. */
export const payoutFailedTotal = new Counter({
  name: 'scadium_payout_failed_total',
  help: 'On-chain payouts that failed or could not be verified (reconcile backlog)',
  labelNames: ['kind'] as const,
  registers: [metricsRegistry],
});
