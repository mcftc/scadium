# Runbook — Postgres backups, PITR & disaster recovery (#52)

Postgres is the system of record (balances, bets, ledger). This runbook defines
backup, point-in-time recovery (PITR), restore drills, and the staging mirror.

## Targets

- **RPO** (max data loss): **≤ 5 minutes** — continuous WAL archiving.
- **RTO** (max downtime): **≤ 30 minutes** — restore latest base backup + replay WAL.

## Production: use managed Postgres

The Helm chart ships an in-cluster Postgres `StatefulSet` for **staging/dev only**.
For production, set `postgres.external.enabled=true` and point `DATABASE_URL` at a
**managed Postgres with built-in PITR** (RDS / Cloud SQL / Crunchy). Managed PITR
gives continuous WAL archiving + one-click restore-to-timestamp, which is the RPO/RTO
above with the least operational risk. The chart never manages production data.

```yaml
# values-prod.yaml
postgres: { external: { enabled: true } }
secrets: { existingSecret: scadium-prod-secrets } # holds DATABASE_URL (managed DSN)
```

## Self-managed PITR (when not on a managed provider)

1. **Base backups** — nightly `pgBackRest`/`wal-g` full backup to off-cluster
   object storage (S3/GCS), retained 14 days.
2. **WAL archiving** — `archive_mode=on`, `archive_command` ships every WAL segment
   to the same bucket continuously (this is what bounds RPO to minutes).
3. **Encryption** — backups encrypted at rest + in transit; bucket access least-priv.

## Restore (PITR)

1. Declare the incident; **`POST /admin/pause`** (kill-switch #56) so no new writes
   race the restore — see [[incident-response]].
2. Provision a fresh Postgres; restore the latest base backup.
3. Replay WAL to the target timestamp (just before the incident):
   `recovery_target_time = '<UTC timestamp>'`.
4. Re-point `DATABASE_URL` (rotate the secret) and `kubectl rollout restart` the API
   + worker.
5. Run `prisma migrate deploy` (idempotent) and the reconciliation sweep
   (`ReconciliationService`) to confirm aggregates/ledger drift is zero before
   **`/admin/resume`**.

## Restore drill (quarterly)

Restore the latest backup into the **staging mirror** and assert: row counts match,
`prisma migrate status` is clean, the reconciliation sweep reports zero drift, and
the app boots green. Record the measured RTO each drill; investigate if it exceeds
the target.

## Staging mirror

A separate release (`helm install scadium-staging ... -f values-staging.yaml`,
in-cluster Postgres) that mirrors prod topology for restore drills and pre-prod
verification. Never holds production secrets or real funds.

## Backups for Redis

Redis holds the maintenance flag, Socket.io adapter state, and BullMQ jobs — all
**reconstructible** (the flag is re-set by ops; jobs are idempotent and re-enqueued).
AOF persistence (`--appendonly yes`, already set) is enough; Redis is **not** a
recovery-critical store. The source of truth is Postgres.
