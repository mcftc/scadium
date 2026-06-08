---
description: Pick the next open Scadium issue (milestone G→M, priority P0→P3) and run the dev pipeline on it
argument-hint: "[phase letter, e.g. G]  (optional — defaults to the earliest open milestone)"
allowed-tools: Bash(gh:*), Bash(git:*), Bash(pnpm:*), Bash(docker:*), Bash(node:*), Read, Edit, Write, Grep, Glob, Task, TodoWrite
---

**Continue where we left off.** Select the single next Scadium task to work and run it through the full pipeline.

## Current state
- Open task issues (no epics): !`gh issue list --repo mcftc/scadium --state open --limit 100 --json number,title,labels,milestone --jq '[.[] | select((.labels|map(.name)|index("epic"))|not) | {n:.number, p:([.labels[].name|select(startswith("priority:"))][0]//"priority:P3"), ph:(.milestone.title//"zzz"), t:.title}] | sort_by(.ph, .p) | .[] | "\(.n)\t\(.ph[0:8])\t\(.p)\t\(.t)"'`
- Open PRs (skip issues that already have one): !`gh pr list --repo mcftc/scadium --state open --json number,headRefName,title --jq '.[] | "#\(.number) \(.headRefName) — \(.title)"'`

## What to do
1. From the list above, pick the **first** open task issue that does **not** already have an open PR, respecting order: earliest milestone first (Phase G before H before … M), then priority (`priority:P0` before P1 before P2 before P3). If the user passed a phase letter in `$ARGUMENTS`, restrict to that milestone. Skip `epic` and `needs-external` issues.
2. Announce the chosen issue number + title and why it's next.
3. Run the full pipeline for it by following **@.claude/commands/dev-task.md** with that issue number as `$1` (developer → tester → reviewer → commit → PR → gate → squash-merge). Honor every hard rule there, especially: no merge on a red gate, and money/fairness/security findings are blocking.
4. When it merges, report the result and name the *next* candidate so the user can simply run `/scadium-next` again.

If there are no eligible open task issues, say so and suggest the next phase epic to break down.
