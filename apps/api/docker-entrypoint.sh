#!/bin/sh
# Container entrypoint (#16, extended 2026-09-21 for Cloudflare Containers).
#
# Responsibilities, in order:
#   1. Provide Redis. Cloudflare has no managed Redis, and Scadium only uses it for
#      EPHEMERAL coordination (SIWS nonces, throttle counters, TTL'd locks, BullMQ).
#      Nothing durable lives there — the economy jobs are driven by Cloudflare Cron
#      Triggers hitting /internal/jobs/:name, not by Redis persistence. So when no
#      external REDIS_URL is configured we run redis-server on loopback with
#      persistence DISABLED, and there is no third-party Redis vendor at all.
#   2. Apply pending Prisma migrations BEFORE serving, so a new schema version never
#      runs against a stale DB — for a money casino, writes against missing
#      columns/constraints must be impossible. `set -e` aborts the boot on failure
#      rather than serving a stale schema. `migrate deploy` is idempotent.
#   3. Start the process(es) named by PROCESS_MODE.
#
# PROCESS_MODE (default `api`) — config-driven so one image serves every topology:
#   api    → the NestJS HTTP/WebSocket API only
#   worker → the BullMQ consumer process only
#   both   → both, in one container (the Cloudflare single-container deployment)
set -e

PROCESS_MODE="${PROCESS_MODE:-api}"
REDIS_PORT="${REDIS_PORT:-6379}"

if [ -z "$REDIS_URL" ]; then
  echo "[entrypoint] no REDIS_URL — starting in-container redis on 127.0.0.1:${REDIS_PORT} (ephemeral, no persistence)"
  redis-server --save '' --appendonly no --bind 127.0.0.1 --port "$REDIS_PORT" &
  REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
  export REDIS_URL
  i=0
  until redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -ge 60 ] && { echo "[entrypoint] redis failed to start" >&2; exit 69; }
    sleep 0.2
  done
  echo "[entrypoint] redis ready"
fi

echo "[entrypoint] applying database migrations (prisma migrate deploy)…"
# Call the CLI binary directly rather than via `pnpm exec`: pnpm's own startup
# added seconds to every cold start, and Cloudflare Containers only waits a
# bounded time for the process to start listening.
./node_modules/.bin/prisma migrate deploy

echo "[entrypoint] migrations applied — starting PROCESS_MODE=${PROCESS_MODE}"
case "$PROCESS_MODE" in
  api)
    exec node /app/apps/api/dist/main.js
    ;;
  worker)
    exec node /app/apps/worker/dist/main.js
    ;;
  both)
    # Start the worker only AFTER the API is listening.
    #
    # Booting both at once cost the API ~14s: the worker builds its own full Nest
    # graph and connects to Postgres, competing for CPU on a 1/4-vCPU instance.
    # Cloudflare Containers only waits 20s for the port, so that delay turned every
    # cold start into a failed request. Waiting on /health is deterministic — no
    # magic sleep — and costs the worker nothing, since Cloudflare Cron is the real
    # scheduling guarantee (see the migration spec §5.2) and every job is idempotent.
    #
    # The API is exec'd into PID 1 so the platform's SIGTERM reaches it directly and
    # enableShutdownHooks() runs — that is the process whose OnModuleDestroy releases
    # engine leadership and clears the crash/jackpot/lottery loops. The worker is
    # deliberately not given a graceful stop; losing it mid-job is a no-op next run.
    (
      until wget -q -O /dev/null "http://127.0.0.1:${API_PORT:-4000}/health" 2>/dev/null; do
        sleep 1
      done
      echo "[entrypoint] api is listening — starting worker"
      exec node /app/apps/worker/dist/main.js
    ) &
    exec node /app/apps/api/dist/main.js
    ;;
  *)
    echo "[entrypoint] unknown PROCESS_MODE='${PROCESS_MODE}' (expected api|worker|both)" >&2
    exit 64
    ;;
esac
