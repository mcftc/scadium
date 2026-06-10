import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

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
