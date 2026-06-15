# Runbook — Incident response & on-call (#54)

Escalation and response for treasury/settlement incidents. The **global pause**
(#56) is the first lever for anything money-moving: it halts all new wagers and
deposits instantly without a redeploy, while in-flight rounds settle and
withdrawals stay open.

```bash
# Pause everything (admin JWT) — see docs/runbooks/staged-rollout.md
curl -fsS -X POST https://<api>/api/v1/admin/pause   -H "Authorization: Bearer $ADMIN_JWT"
curl -fsS -X POST https://<api>/api/v1/admin/resume  -H "Authorization: Bearer $ADMIN_JWT"
curl -fsS https://<api>/api/v1/status   # {"paused":true|false}
```

On-call rotation: primary acks within 15 min; escalate to secondary at 30 min and
to the treasury owner for any cosigner/treasury incident.

## 1. Treasury low (bankroll under floor)

**Signal:** `scadium_low_bankroll_alerts_total` increasing and/or
`scadium_house_vault_lamports` below the reserve floor (see [[bankroll-model]]).
The pre-payout guard also starts refusing wins (`scadium_treasury_payout_blocked_total`).

**Response:** (1) `/admin/pause` if refusals are user-visible; (2) top up the hot
house vault from cold/treasury (procedure in [[key-management]]); (3) confirm the
gauge recovers above floor; (4) `/admin/resume`.

## 2. Failed-payout backlog (no silent loss)

**Signal:** `scadium_payout_failed_total{kind}` increasing — on-chain payouts that
returned null (failed/unverified). The round still settled atomically off-chain
(Phase G); the on-chain leg is pending.

**Response:** the reconcile sweeps re-attempt unpaid legs
(`reconciliation.service.ts` — lottery prize sweep #29; settlement reconcile).
Verify the backlog drains; if a payout keeps failing, inspect the RPC/program
error, and if it's solvency, treat as incident #1. Never hand-credit off a null.

## 3. Cosigner compromise

**Signal:** unexpected signed txs, key exposure, or host compromise.

**Response:** (1) `/admin/pause` immediately; (2) rotate the cosigner —
`POST /api/v1/admin/cosigner/reload` after provisioning a new key (procedure in
[[key-management]]); the rotation is audit-logged; (3) revoke the old key's
on-chain authority; (4) reconcile recent settlements for unauthorized movement;
(5) `/admin/resume` only after the new key is confirmed active (`reload` returns
the active public key) and the old key is rejected on-chain.

## 4. Kill-switch / staged rollout

The pause is also the rollback lever for a bad real-money deploy — see
[[staged-rollout]]. Re-check `GET /status` after any pause/resume (the write fails
LOUD: a 5xx means the flag is indeterminate, verify before assuming a state).

## Deferred (needs infra)

Alertmanager rules that fire these signals to the on-call pager live in the Helm
chart (Phase M infra, #52) — not yet present. Until then, alert on the Prometheus
metrics above via whatever scrape/alerting is wired to `GET /metrics`.
