# Scadium — Audits

External security audit + pentest artifacts (#51). Real funds must not flow until a
third-party audit of the three Anchor programs and a full-system pentest are complete
and all Critical/High findings are remediated (`ANALYSIS.md` §9 gating checklist).

## Contents

| File | Purpose | Status |
|---|---|---|
| [scope.md](./scope.md) | Audit/pentest scope, pinned revision, build repro, vendor refs | ✅ prep |
| [threat-model.md](./threat-model.md) | Assets, trust boundaries, abuse cases | ✅ prep |
| `program-audit-*.pdf` | Final signed program audit report(s) | ⏳ pending engagement |
| `pentest-api.pdf` | Final API/auth/settlement pentest report | ⏳ pending engagement |

## Status

**Pre-engagement.** The prep package is assembled; vendor selection + engagement are
external and tracked on #51. The programs are still pre-Phase-J (decorative on-chain
layer) — the audit must run against the **deployed, balance-wired** Phase-J revision, so
the engagement is gated on Phase J (#24) and the cosigner KMS hardening (#36 managed
signer). Re-pin the commit SHA in `scope.md` before engaging.

## Publishing

On completion: commit the signed reports here, file each finding as a `type:security`
issue with the vendor severity, remediate Critical/High with a regression test per
finding, and link the published reports from the whitepaper/fairness page. The
`audit-status` CI gate blocks the pipeline while any open Critical/High `type:security`
issue exists in the Phase M milestone.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).
