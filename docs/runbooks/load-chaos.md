# Load & Chaos Runbook (#55)

Proves the §9 gating invariants — settlement atomicity, balance races, restart
safety, horizontal scale — under realistic concurrency before real funds. This
runbook covers the **chaos integration suite** and the **load harness** (#178),
plus the **multi-replica chaos** scenarios (#179 — kill-9 recovery +
reveal-callback failure). The multi-hour staging soak + nightly CI (#180) is
tracked separately.

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

## Multi-replica chaos (#179)

Two scenarios that need real cross-pod leader election (Redis lock
`lock:engine:*`, `apps/api/src/redis/leader-election.ts`) + boot reconciliation.
They run in the same integration harness (`test/setup.ts`, real Postgres + Redis)
as the #178 suite:

```bash
docker compose -f infra/docker-compose.yml up -d   # Postgres + Redis (Redis is REQUIRED — engines run in election mode)
export TEST_DATABASE_URL=postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public
pnpm --filter @scadium/api exec vitest run --config vitest.integration.config.ts \
  test/chaos/kill9-recovery.e2e-spec.ts test/chaos/vrf-callback-failure.e2e-spec.ts
```

- `test/chaos/kill9-recovery.e2e-spec.ts` — replica A wins `lock:engine:crash`,
  takes a real crash bet (debited, durable CrashBet, round non-terminal), then A's
  Redis is force-disconnected (the exact effect of a SIGKILL: the lock can be
  neither renewed nor released, so it TTLs out). Standby replica B acquires the
  lapsed lock and runs `recoverStrandedRounds` (#14). Invariant: zero rounds left
  `running`/`waiting`, the stake refunded in full, and `reconcileAll()` → zero drift.
- `test/chaos/vrf-callback-failure.e2e-spec.ts` — `chain.lotteryRevealDraw`
  returns `null` (failed VRF/reveal callback). The lottery draw must still settle
  atomically via the documented synthetic-slot-hash fallback (`synthetic-not-fair`,
  ADR 0002 / #19a): every ticket gets a terminal won/lost `Bet` row, no buyer is
  left debited-without-resolution, and `reconcileAll()` → zero drift. A second
  case drives the reveal-SUCCEEDS path (`onchain`) for the "then succeed" half.

> **Premise note (#179):** the product mechanism is **boot reconciliation after a
> Redis-lock leader takeover**, not in-process hot failover; and a null reveal
> **falls back + reconciles**, it does not retry the reveal. The specs assert the
> real guarantees (zero stranded bets / zero buyer left unresolved + zero drift).

### Out-of-process variant — 2 real containers + an actual SIGKILL

`apps/api/test/chaos/docker-compose.chaos.yml` boots **two real API replicas**
(reusing `apps/api/Dockerfile`) + Postgres + Redis for a true kill-9:

```bash
docker compose -f apps/api/test/chaos/docker-compose.chaos.yml up -d --build
# seed a JWT + place a crash bet against the leader (api-1 → :4001), then:
docker compose -f apps/api/test/chaos/docker-compose.chaos.yml kill -s SIGKILL api-1
# api-2 (:4002) acquires the lock after the ~10s TTL and reconciles on boot.
docker compose -f apps/api/test/chaos/docker-compose.chaos.yml down -v
```

## Soak (placeholder — #180)

Multi-hour soak against a staging mirror, recording memory/latency/reconciliation
trend with a pass verdict, runs from the staging soak slice (#180, needs a
staging environment). Record results below when that lands.

| Date | Duration | p95 | Mem drift | Reconciliation | Verdict |
| ---- | -------- | --- | --------- | -------------- | ------- |
| _pending #180_ | | | | | |
