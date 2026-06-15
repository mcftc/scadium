# Licensing & Real-Money Readiness (Phase L · #49)

Obtaining a gaming licence is an **EXTERNAL / business** deliverable (legal
counsel, regulator application, fees) — it has **no in-repo code change**. This
document tracks that business track and maps each ANALYSIS.md §9 "Compliance
live" gate to its implementing task, so the codebase can flip from
play-money → real money atomically once the licence is held.

## Real-money flip (in-repo)

Real money is gated by a single fail-closed switch, `REAL_MONEY_ENABLED`. The API
**refuses to boot** (`assertRealMoneyReady`, wired in `main.ts`) when it is `true`
unless:

- a licence is configured — `LICENSE_NUMBER` / `LICENSE_REGULATOR` /
  `LICENSE_JURISDICTION` (exposed fail-closed via `ComplianceService.licensed`), and
- KYC is enabled — `KYC_ENABLED=true`.

Geoblocking runs via the global `GeoGuard` (fail-open on a missing geo header;
full hardening tracked in #149).

## Business track (external — NOT a code change)

- [ ] Choose target jurisdiction(s) and engage gaming-law counsel.
- [ ] Incorporate / licence-holding entity + AML program sign-off.
- [ ] Submit the regulator application; obtain the licence number + regulator.
- [ ] Independent RNG/fairness certification (consumes `packages/fair`).
- [ ] Funded, audited bankroll + treasury controls.

## §9 "Compliance live" checklist → implementing task

| §9 sub-item | Implementing task | Status |
|---|---|---|
| Remove false "Licensed & regulated" claim | #41 | merged |
| Gate misleading "on-chain settlement" copy | #42 | merged |
| Geofencing / VPN block | #43 | merged |
| 18+ age gate | #44 | merged |
| KYC / identity verification gating deposits/withdrawals | #45 | merged |
| Responsible-gambling controls (limits / cool-off / self-exclusion) | #46 | merged |
| Versioned legal pages + acceptance + cookie consent | #48 | merged |
| Server-side age-gate enforcement on bet endpoints | #146 | open |
| Real-money hardening (fail-closed geo, trusted proxy, VPN provider) | #149 | open |
| Valid gaming licence obtained | this doc (external/business) | pending |
| Real-money master switch gated on the above | #49 | this PR |

> The licence itself remains a business deliverable; this PR delivers only the
> engineering hooks (config + boot gate) that consume it.
