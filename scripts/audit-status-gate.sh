#!/usr/bin/env bash
# audit-status gate (#51): block the pipeline while any OPEN security finding of
# Critical/High severity exists in the Phase M milestone. Findings are tracked as
# GitHub issues labeled `type:security` + `phase:M` + `severity:critical|high`
# (the labels an auditor's findings get filed under). Passes when there are none
# — so it is a no-op until real findings are filed.
#
# Requires `gh` authenticated (GH_TOKEN in CI).
set -euo pipefail

total=0
for sev in critical high; do
  # --limit well above any realistic finding count (default cap is 30). Trap a gh
  # auth/network failure explicitly so it can't be mistaken for "0 findings" OR
  # silently block the pipeline as an indistinguishable infra error.
  n=$(gh issue list --state open \
        --label type:security --label phase:M --label "severity:${sev}" \
        --limit 200 --json number --jq 'length') || {
    echo "::error::gh issue list failed (auth/network/rate-limit) — cannot verify audit status."
    exit 1
  }
  if [ "${n}" -gt 0 ]; then
    echo "::error::${n} open ${sev}-severity security finding(s) in Phase M — blocking real-money cutover (#51)."
    gh issue list --state open \
      --label type:security --label phase:M --label "severity:${sev}" \
      --limit 200 --json number,title --jq '.[] | "  #\(.number) \(.title)"'
    total=$((total + n))
  fi
done

if [ "${total}" -gt 0 ]; then
  echo "audit-status: ${total} open Critical/High finding(s) — see #51."
  exit 1
fi
echo "audit-status: no open Critical/High security findings in Phase M ✓"
