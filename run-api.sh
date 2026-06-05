#!/usr/bin/env bash
cd "$(dirname "$0")/apps/api"
set -a; . ../../.env 2>/dev/null; set +a
export DATABASE_URL="postgresql://scadium:scadium@localhost:5432/scadium?schema=public"
exec node dist/main.js
