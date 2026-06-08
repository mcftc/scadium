---
description: Run the full developer→tester→reviewer→merge pipeline for one Scadium issue
argument-hint: <issue-number>
allowed-tools: Bash(gh:*), Bash(git:*), Bash(pnpm:*), Bash(docker:*), Bash(node:*), Read, Edit, Write, Grep, Glob, Task, TodoWrite
---

You are the **orchestrator** for Scadium's end-to-end development pipeline. Drive issue **#$1** from open ticket to merged PR by coordinating the role agents. You do the git/gh plumbing and the agents do the focused work. Never skip the verify, test, or review gate.

## Context (read first)
- Issue: !`gh issue view $1 --repo mcftc/scadium`
- Repo conventions: @CLAUDE.md
- Audit / roadmap / gating: @ANALYSIS.md
- Current branch: !`git branch --show-current`

## Pipeline — execute in order

1. **Pre-flight.** Confirm a clean tree on `main` (`git status`, `git checkout main`, `git pull`). If `#$1` is an **epic** (label `epic`) or `needs-external`, stop and report — epics are tracked, not implemented; external tasks need a human. If an open PR already references this issue, stop and report it.
2. **Branch.** Create `git checkout -b <type>/<slug>-<issue#>` where `<type>` ∈ {fix, feat, chore, test, refactor} from the issue's `type:*` label and `<slug>` is a short kebab summary.
3. **Implement.** Use the **Task** tool with `subagent_type: scadium-developer`, passing the full issue body and the rule: *verify the premise against the real code before changing anything; if the audit was wrong, post the discrepancy and only implement what's genuinely needed.* If it reports a premise discrepancy, `gh issue comment $1` with the correction.
4. **Test.** Use the **Task** tool with `subagent_type: scadium-tester`, passing the issue's "E2E / test requirements" and the developer's "Notes for the tester". Require real run output and red-before/green-after. If the tester's verdict is FAIL because the product code is wrong, loop back to step 3 (max 3 dev↔test iterations) — do not proceed on red tests.
5. **Review.** Use the **Task** tool with `subagent_type: scadium-reviewer`, passing the diff and the issue's acceptance criteria. If `REQUEST_CHANGES`, address each blocking finding via the developer agent and re-run the tester, then re-review (max 3 review iterations). Only a clean `APPROVE` proceeds.
6. **Commit & PR.** Commit with a Conventional-Commits message referencing `#$1`, ending with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. `git push -u origin <branch>`. Open the PR with `gh pr create` — title from the issue, body containing: `Closes #$1`, the developer's change summary, the tester's run output, the reviewer's verdict, and a "Verification performed" checklist. End the PR body with the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.
7. **Gate & merge.** Wait for CI (`gh pr checks <pr> --watch`). **Merge only when ALL hold:** CI green (or, where the project's CI does not yet cover this code — see #39 — the tester's local run is green and you say so explicitly), reviewer verdict = APPROVE, and every acceptance-criteria box is satisfiable. Then `gh pr merge <pr> --squash --delete-branch`. If CI is red, fix and repeat from the failing step. **Never merge on a red gate.**
8. **Close out.** Confirm the issue auto-closed (the `Closes #$1`), post a one-line completion summary, and report which milestone/issue is next (suggest `/scadium-next`).

## Hard rules
- This is a **money-handling casino**. A change that can double-spend, mint balance, settle non-atomically, leak a fairness secret, or skip auth must NOT merge regardless of green tests — the reviewer agent is the authority and any such finding is blocking.
- Every task ships with the tests its issue mandates. No tests → no merge.
- Stay within issue #$1's scope. File a new issue (`gh issue create`) for anything adjacent you discover; don't expand the PR.
- Keep a running TodoWrite list of the pipeline steps so progress is visible.
