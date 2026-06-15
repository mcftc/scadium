# Runbook — Global pause / kill-switch & staged rollout

This runbook covers the **global pause** (kill-switch) introduced in #56 and how it
fits into a staged real-money rollout. The pause is the single lever ops use to
stop all new money movement immediately without redeploying.

## What the pause does

When the pause is **on**:

- The API rejects **every new wager** and **every deposit** with
  `503 Service Unavailable` ("paused for maintenance"). This is enforced in
  `RgService.assertCanWager` / `assertCanDeposit` — the single responsible-gambling
  gate that every game and the vault deposit path already route through, so there is
  no per-game wiring to keep in sync.
- The public `GET /api/v1/status` endpoint returns `{ "paused": true }`.
- The web app shows a site-wide maintenance banner and disables the
  Deposit/Withdraw buttons.
- On-chain: `ChainService.setPaused(true)` is invoked. While the vault program is
  undeployed this is a logged no-op; once deployed it will issue the program's
  `set_paused` instruction (TODO in `chain.service.ts`).

What the pause **does not** block (by design):

- **Cash-outs of in-flight rounds and withdrawals** — players must always be able
  to get money out. Only *new* exposure is stopped.
- Read-only traffic (history, balances, fairness verification).

The flag is stored in Redis (`scadium:maintenance:paused`) so it is shared across
all API instances and survives a rolling restart. If Redis is unreachable the check
**fails open** (treats the platform as not paused) — the pause is an ops safety lever,
not an auth boundary, and we do not want a Redis blip to take the whole site down.

## Operating the switch

Admin-only (requires an admin JWT — see `assertAdmin`):

```bash
# Pause everything (stop new wagers + deposits)
curl -fsS -X POST https://<api>/api/v1/admin/pause   -H "Authorization: Bearer $ADMIN_JWT"

# Resume
curl -fsS -X POST https://<api>/api/v1/admin/resume  -H "Authorization: Bearer $ADMIN_JWT"

# Verify
curl -fsS https://<api>/api/v1/status   # -> {"paused":true|false}
```

## Staged real-money rollout

The pause is step 0 of the rollout: bring real money up **paused**, verify, then
un-pause for a small cohort.

1. **Pre-flight** — `assertRealMoneyReady` passes (compliance: licensed +
   `realMoneyEnabled`, geo/VPN guard live, KYC enabled, legal gates current). See
   `docs/compliance/licensing.md`.
2. **Deploy paused** — ship the real-money config with the pause **on**. The site is
   live but accepts no wagers/deposits. Smoke-test auth, balances, status banner.
3. **Canary un-pause** — un-pause and let a small internal/whitelist cohort transact.
   Watch error rates, settlement ledger integrity, and withdrawal latency.
   *(Per-cohort beta whitelist is a follow-up; today un-pause is global.)*
4. **Caps** — per-user deposit/loss/wager caps from #46 are already enforced; start
   conservative and raise them as confidence grows.
5. **Ramp** — widen the cohort. If anything looks wrong, hit `/admin/pause`
   (single command, instant, no deploy) and investigate.
6. **Rollback** — pause, drain in-flight rounds (cash-outs still work), then revert
   the deploy if needed.

## Follow-ups (deferred from #56)

- On-chain `set_paused` instruction (blocked on vault deployment).
- Per-cohort beta whitelist for canary un-pause.
- Auto-pause hooks (trip the switch on bankroll/anomaly alerts).
