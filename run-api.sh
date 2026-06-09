#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/apps/api"
set -a; . ../../.env 2>/dev/null || true; set +a
export DATABASE_URL="${DATABASE_URL:-postgresql://scadium:scadium@localhost:5432/scadium?schema=public}"
# Apply pending migrations before serving (#16) — never serve a stale schema.
# `set -e` aborts startup if the migration fails. Idempotent when at head.
pnpm exec prisma migrate deploy
exec node dist/main.js
