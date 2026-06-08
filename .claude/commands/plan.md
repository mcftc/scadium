---
description: Turn a described need into grounded GitHub issues (epic + tasks) for Scadium, ready for the dev pipeline
argument-hint: <describe what you need, in your own words>
allowed-tools: Bash(gh:*), Bash(git:*), Read, Grep, Glob, Task, Write, TodoWrite
---

You are the **planning orchestrator**. The user described a need:

> $ARGUMENTS

Turn it into a proper GitHub plan — epic + discrete task issues, just like the existing roadmap — and create them on `mcftc/scadium`. You do the `gh` plumbing; the planner agent does the decomposition.

## Context
- Existing open issues (avoid duplicates): !`gh issue list --repo mcftc/scadium --state open --limit 100 --json number,title --jq '.[] | "#\(.number) \(.title)"'`
- Milestones: !`gh api repos/mcftc/scadium/milestones --jq '.[].title'`
- Conventions: @CLAUDE.md  ·  Roadmap/analysis: @ANALYSIS.md

## Steps

1. **Plan.** Use the **Task** tool with `subagent_type: scadium-planner`, passing the need ($ARGUMENTS). It explores the real code and returns a structured plan: placement (existing or new milestone), any new labels, an optional epic, and task issues with full bodies (Context / Current state / Scope / Acceptance criteria / **E2E test requirements** / Files / Dependencies / References).
2. **Show the plan & confirm.** Summarize the proposed issues as a short list — `[priority] title` grouped under the epic, plus the target milestone — and any duplicates the planner flagged. If the request was ambiguous and the planner stated an assumption, surface it. Use **AskUserQuestion** to confirm "create these N issues?" unless the user already said to just create them. Respect their edits.
3. **Ensure labels & milestone.** For every label the plan uses, `gh label create "<name>" --color <hex> --description "..." --repo mcftc/scadium 2>/dev/null || true` (reuse the project palette: priority:P0=B60205, P1=D93F0B, P2=FBCA04, P3=C2E0C6, type:*=mixed, epic=6f42c1, needs-external=cccccc; new labels → a neutral color). If the plan proposes a new milestone, create it with `gh api repos/mcftc/scadium/milestones -f title=... -f description=...`; otherwise reuse the named existing one.
4. **Create issues.** If there's an epic, create it first (`gh issue create` with its labels + milestone), capture its number. Then create each task issue (labels incl. `priority:*`, the milestone, and a trailing `_Part of epic #<n>._` when there's an epic). Write long bodies to a temp file and use `gh issue create --body-file` to avoid quoting problems. Finally, edit the epic body to append a `## Child task issues` checklist of `- [ ] #<n> — [P?] <title>`.
5. **Report.** List the created issue numbers + the milestone, and tell the user they can run **`/scadium-next`** (or `/dev-task <#>`) to implement them through the developer→tester→reviewer→merge pipeline.

## Rules
- **Don't duplicate** an existing open issue — if the need overlaps one, link/extend it instead of creating a near-copy.
- **Every task issue must keep its `## E2E / test requirements` section** — that's a project rule; do not strip it.
- Keep tasks small and independently shippable; prefer more precise issues over a few broad ones.
- You **plan and file** here — you do not implement. Implementation goes through the pipeline afterward.
- Track the steps with TodoWrite so progress is visible.
