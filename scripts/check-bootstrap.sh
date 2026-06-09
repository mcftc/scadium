#!/usr/bin/env bash
# #16 bootstrap guard — deterministic, CI-runnable. FAILS on the old config,
# PASSES after the fix:
#   1. `turbo run dev` schedules @scadium/{shared,fair} build BEFORE the dev
#      servers, so a clean clone can `pnpm dev` without unresolved-module errors.
#   2. The API entrypoints (docker-entrypoint.sh, run-api.sh) run
#      `prisma migrate deploy` BEFORE `node dist/main.js`, so a deploy never
#      serves against a stale schema.
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { echo "FAIL: $1" >&2; exit 1; }

# 1. turbo dev must schedule the workspace package builds (dependsOn ^build).
tasks=$(pnpm exec turbo run dev --dry-run=json 2>/dev/null \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);process.stdout.write(j.tasks.map(t=>t.taskId).join('\n'));})")
echo "$tasks" | grep -qx '@scadium/shared#build' \
  || fail "turbo 'dev' does not schedule @scadium/shared#build — add dependsOn:[\"^build\"] to the dev task"
echo "$tasks" | grep -qx '@scadium/fair#build' \
  || fail "turbo 'dev' does not schedule @scadium/fair#build — add dependsOn:[\"^build\"] to the dev task"

# 2. Entrypoints must migrate before serving.
for f in apps/api/docker-entrypoint.sh run-api.sh; do
  [ -f "$f" ] || fail "$f does not exist"
  grep -q 'prisma migrate deploy' "$f" || fail "$f does not run 'prisma migrate deploy'"
  md=$(grep -n 'prisma migrate deploy' "$f" | head -1 | cut -d: -f1)
  nd=$(grep -n 'node dist/main.js' "$f" | head -1 | cut -d: -f1)
  { [ -n "$md" ] && [ -n "$nd" ] && [ "$md" -lt "$nd" ]; } \
    || fail "$f must run 'prisma migrate deploy' BEFORE 'node dist/main.js'"
done
grep -q 'docker-entrypoint.sh' apps/api/Dockerfile \
  || fail "apps/api/Dockerfile does not invoke docker-entrypoint.sh"

echo "OK: turbo dev builds @scadium/{shared,fair} first; API entrypoints migrate-on-deploy before serving."
