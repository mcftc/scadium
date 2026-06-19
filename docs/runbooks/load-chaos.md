# Load & Chaos Runbook (#55)

Proves the §9 gating invariants — settlement atomicity, balance races, restart
safety, horizontal scale — under realistic concurrency before real funds. This
runbook covers the **chaos integration suite** and the **load harness** (#178).
Multi-replica kill-9 (#179) and the multi-hour staging soak + nightly CI (#180)
are tracked separately.

## Prerequisites

```bash
docker compose -f infra/docker-compose.yml up -d           # Postgres + Redis
# test DB (defaults to scadium_test on localhost):
DATABASE_URL=postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public \
  pnpm --filter @scadium/api exec prisma migrate deploy
```

## Chaos integration suite

Reconciliation-verified money-safety scenarios (real Postgres). Each asserts the
invariant **and** runs `ReconciliationService.reconcileAll()` → zero drift.

```bash
export TEST_DATABASE_URL=postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public
pnpm --filter @scadium/api exec vitest run --config vitest.integration.config.ts test/chaos
```

- `test/chaos/balance-race.e2e-spec.ts` — 50 concurrent crash bets on a one-bet
  balance → exactly one wins, balance never negative, zero drift. Proves the
  Phase G conditional debit (`applyBalanceDelta` guarded `updateMany`).
- `test/chaos/coinflip-double-join.e2e-spec.ts` — two racing joins on one open
  flip → exactly one resolves, one payout (no double-pay), zero drift.

**Red-before guarantee:** both fail if the Phase G atomic-debit / serializable-
resolve guards are reverted (the read-then-decrement debit lets multiple bets win
and drives the balance negative → reconciliation drift).

## Load harness

[`load/crash-mixed.js`](../../load/crash-mixed.js) drives mixed traffic
(crash bet / coinflip create / lottery state / rewards summary) and reports p95
latency + error rate.

```bash
cd load && npm install                 # one-time (autocannon; outside the pnpm workspace)
# seed a player JWT first (e.g. via the API or a prisma:seed session), then:
TOKEN=<jwt> API_URL=http://localhost:4000 CONNECTIONS=50 DURATION=30 node crash-mixed.js
```

Without `TOKEN` it smoke-tests the public read paths only. Tune `CONNECTIONS` /
`DURATION` to the expected target concurrency.

## Soak (placeholder — #180)

Multi-hour soak against a staging mirror, recording memory/latency/reconciliation
trend with a pass verdict, runs from the staging soak slice (#180, needs a
staging environment). Record results below when that lands.

| Date | Duration | p95 | Mem drift | Reconciliation | Verdict |
| ---- | -------- | --- | --------- | -------------- | ------- |
| _pending #180_ | | | | | |
