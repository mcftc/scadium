# Scadium dev pipeline (Claude Code)

This folder ships an **end-to-end, multi-agent development workflow** so any contributor with
[Claude Code](https://claude.com/claude-code) can pick up a tracked issue and take it all the way
to a merged, tested, reviewed PR — without hand-merging. It's committed to the repo, so you get it
on clone.

## TL;DR

```text
/plan <what you need>  # decompose a need into GitHub issues (epic + tasks), just like the roadmap
/scadium-next          # work the next open issue (Phase G→M, P0→P3 order)
/dev-task 14           # work a specific issue by number
```

`/plan` is how new work enters the system; `/scadium-next` and `/dev-task` are how it gets built.

Both run the same pipeline:

```
issue ──▶ scadium-developer ──▶ scadium-tester ──▶ scadium-reviewer ──▶ PR ──▶ CI gate ──▶ squash-merge
              (implement)          (write+run         (adversarial          (auto, only when
              verify premise        the issue's        money/fairness/        CI green AND
              first                 unit+integration+   security review,       reviewer APPROVE)
                                    e2e tests,          acceptance-criteria
                                    red→green)          check)
```

The orchestrator (`/dev-task`) does the git/gh plumbing and coordinates three role agents:

| Agent | Role |
|---|---|
| **scadium-planner** | Turns a described need into grounded GitHub issues (epic + tasks, acceptance criteria, **E2E requirements**, milestone, labels) — explores the real code first. Used by `/plan`. |
| **scadium-developer** | Implements one issue, minimal & idiomatic, **verifies the audit premise against the real code first** (the audit has been wrong — e.g. #3). |
| **scadium-tester** | Writes & runs the unit / integration (real test Postgres) / e2e tests the issue mandates; proves red-before / green-after. |
| **scadium-reviewer** | Adversarial gate: money-integrity, provable fairness, security, acceptance criteria, test adequacy, open PR/CI comments. |

### Adding new work — `/plan`

```text
/plan add a "Plinko" game with provably-fair payouts, bet panel, and live multiplayer feed
```

`/plan` runs the **scadium-planner** agent: it explores the codebase, decomposes the need into an epic + small task issues (each with Context · evidence · scope · acceptance criteria · **E2E test requirements** · files · dependencies), proposes a milestone (existing Phase G–M or a new one) + labels, confirms with you, then **creates the issues on GitHub** — exactly the shape of the roadmap issues. Then `/scadium-next` will pick them up and build them.

## Ground rules baked into the pipeline

- **Money-handling casino:** a change that can double-spend, mint balance, settle non-atomically,
  leak a fairness secret, or skip auth **does not merge**, green tests or not. The reviewer is the authority.
- **Every task ships with its tests.** No tests → no merge. E2E is required across all phases (see each issue's "E2E / test requirements").
- **No merge on a red gate.** Merge only when CI is green (or the tester's local run is green where CI doesn't yet cover the code — tracked in #39) **and** the reviewer returns `APPROVE`.
- **Scope discipline:** stay inside the issue; file a new issue for anything adjacent.

## Source of truth = GitHub

Work is tracked as **issues + milestones** on `mcftc/scadium`:

- Milestones **Phase G → Phase M** (the roadmap from [`ANALYSIS.md`](../ANALYSIS.md)).
- Labels: `phase:G…M`, `priority:P0…P3`, `type:*`, `epic`, `needs-external`.
- Epics group their child tasks; `/scadium-next` always picks the earliest-milestone, highest-priority
  open *task* (never an epic, never `needs-external`).

So "continue where we left off" is just: open the repo in Claude Code and run **`/scadium-next`**.

## Files

```
.claude/
├── agents/
│   ├── scadium-planner.md     # decomposes a need into issues (used by /plan)
│   ├── scadium-developer.md
│   ├── scadium-tester.md
│   └── scadium-reviewer.md
├── commands/
│   ├── plan.md          # /plan <need>        — create issues for a new need
│   ├── dev-task.md      # /dev-task <issue#>  — full pipeline for one issue
│   └── scadium-next.md  # /scadium-next       — pick the next issue and run it
└── README.md
```

Full lifecycle: **`/plan`** (need → issues) → **`/scadium-next`** or **`/dev-task`** (issue → developer → tester → reviewer → merged PR).

Local/session state under `.claude/` (e.g. `settings.local.json`) stays git-ignored; only the shared
agents, commands, and this README are tracked.
