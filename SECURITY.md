# Security Policy

Scadium is a non-custodial, provably-fair Solana casino. Player funds and the
integrity of game settlement are the assets we care about most. We welcome
coordinated disclosure of vulnerabilities.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Email **security@scadium.example** (replace with the real address before launch)
with:

- a description and impact (what an attacker can do),
- reproduction steps or a proof-of-concept,
- the affected component (program / API endpoint / commit SHA),
- your assessment of severity.

We aim to acknowledge within **2 business days** and to provide a remediation
timeline after triage. Please give us a reasonable window to fix before public
disclosure. We do not currently run a paid bounty; we credit reporters (with
consent) in the published audit notes.

## Scope

In scope: the Anchor programs (`programs/scadium_{vault,swap,lottery}`), the API
auth/settlement/treasury path (`apps/api`), and the deployment posture
(`infra/`). See [audits/scope.md](./audits/scope.md) and
[audits/threat-model.md](./audits/threat-model.md) for the full surface.

Out of scope: third-party dependency code (tracked via `cargo audit` / `pnpm
audit`), the play-money demo's economic balance, and front-end visual issues
without a security impact.

## Current posture

- The product runs in **play-money** mode today; the on-chain layer is not yet
  deployed with real value (`ANALYSIS.md`).
- Real funds will not be enabled until a third-party program audit + full-system
  pentest are complete with all Critical/High findings remediated (#51), and the
  real-money gating checklist (`ANALYSIS.md` §9) is fully green.

## Safe harbor

Good-faith, non-destructive research that respects user privacy and avoids
service disruption will not be pursued legally. Do not access other users' data,
degrade the service, or exfiltrate funds beyond what's needed to prove a finding.
