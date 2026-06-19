// @ts-nocheck
/**
 * Mixed-load harness (#178, slice of #55). Drives the expected target
 * concurrency across the hot endpoints — crash bet, coinflip create, lottery
 * state, rewards summary — and reports p95 latency + error rate.
 *
 * Run:  TOKEN=<jwt> node load/crash-mixed.js
 * Env:
 *   API_URL      base API URL          (default http://localhost:4000)
 *   TOKEN        a player JWT for authed POSTs (seed one first — see the runbook)
 *   CONNECTIONS  concurrent connections (default 50)
 *   DURATION     seconds               (default 30)
 *   STAKE        lamports per bet      (default 1000000 = 0.001 SOL)
 *
 * Authed requests are skipped (with a warning) when TOKEN is unset, so the
 * script still smoke-tests the public read paths. See docs/runbooks/load-chaos.md.
 */
const autocannon = require('autocannon');

const API_URL = process.env.API_URL || 'http://localhost:4000';
const TOKEN = process.env.TOKEN || '';
const CONNECTIONS = Number(process.env.CONNECTIONS || 50);
const DURATION = Number(process.env.DURATION || 30);
const STAKE = process.env.STAKE || '1000000';

const authHeaders = TOKEN
  ? { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }
  : { 'content-type': 'application/json' };

if (!TOKEN) {
  console.warn('⚠  TOKEN unset — running PUBLIC read paths only. Seed a JWT for the full mix.');
}

// Weighted request mix. Public reads always run; authed writes only with a TOKEN.
const requests = [
  { method: 'GET', path: '/api/v1/lottery/state', weight: 2 },
  { method: 'GET', path: '/api/v1/coinflip/open', weight: 1 },
];
if (TOKEN) {
  requests.push(
    {
      method: 'POST',
      path: '/api/v1/crash/bet',
      headers: authHeaders,
      body: JSON.stringify({ amountLamports: STAKE }),
      weight: 4,
    },
    {
      method: 'POST',
      path: '/api/v1/coinflip',
      headers: authHeaders,
      body: JSON.stringify({ side: 'heads', amountLamports: STAKE }),
      weight: 2,
    },
    { method: 'GET', path: '/api/v1/rewards/summary', headers: authHeaders, weight: 2 },
  );
}

const instance = autocannon(
  {
    url: API_URL,
    connections: CONNECTIONS,
    duration: DURATION,
    headers: { 'content-type': 'application/json' },
    requests,
  },
  (err, result) => {
    if (err) {
      console.error('load run failed:', err);
      process.exit(1);
    }
    const p95 = result.latency.p97_5 ?? result.latency.p99 ?? result.latency.p95;
    console.log('\n=== load summary ===');
    console.log(`requests:   ${result.requests.total} (${result.requests.average}/s avg)`);
    console.log(`latency:    p50=${result.latency.p50}ms p95=${result.latency.p95}ms p99=${result.latency.p99}ms`);
    console.log(`errors:     ${result.errors}  non-2xx: ${result.non2xx}  timeouts: ${result.timeouts}`);
    const errorRate = result.requests.total ? (result.non2xx + result.errors) / result.requests.total : 0;
    console.log(`error rate: ${(errorRate * 100).toFixed(2)}%`);
    void p95;
  },
);

autocannon.track(instance, { renderProgressBar: true });
