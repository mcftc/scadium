#!/bin/sh
# API container entrypoint (#16): apply pending Prisma migrations BEFORE serving,
# so a new schema version never runs against a stale DB — for a money casino,
# writes against missing columns/constraints (e.g. the Phase G BalanceLedger /
# CHECK constraints) must be impossible. `set -e` aborts the boot with a
# non-zero exit if the migration fails, rather than serving a stale schema.
# `migrate deploy` is idempotent: a no-op when the DB is already at head.
set -e

echo "[entrypoint] applying database migrations (prisma migrate deploy)…"
pnpm exec prisma migrate deploy

echo "[entrypoint] migrations applied — starting API…"
exec node dist/main.js
