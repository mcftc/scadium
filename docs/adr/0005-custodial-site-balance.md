# ADR 0005 — Custodial site balance for SOL; custody leaves the vault program

**Status:** Accepted (2026-09-24) · supersedes the custody half of [ADR 0003](./0003-offchain-first-hybrid-scad-engine.md)'s on-chain boundary · design: `docs/superpowers/specs/2026-09-24-wallet-custody-design.md`

## Context

Players must deposit, play and withdraw with a real wallet. The only custody code was
the `scadium_vault` path: SOL in a user-owned PDA, a Postgres mirror for play, and a
cosigner-signed `settle_bet` to move net results. It was never enabled, and it cannot
be: the owner can withdraw at any time without the server, so losses are
uncollectable (`settle_bet` has no callers, and a withdrawal can front-run it), while
`settle_bet` lets the server key move any amount out of any user vault. It carries
the risk of custody and the exposure of non-custody at once.

## Options

| | A. Custodial site balance | B. Locked vault + escape hatch | C. Every bet on chain |
| --- | --- | --- | --- |
| Game code | unchanged | unchanged | four engines rewritten |
| Program change / audit | none | yes / yes | yes / yes |
| Test setup | RPC + test SOL | program deploy + validator | program deploy + validator |
| Auto-bet, instant rebets | yes | yes | no (a wallet prompt per bet) |
| Trust | operator holds funds | operator can delay, not keep | trustless for stakes |

## Decision

**A.** SOL deposits are plain transfers to a server hot wallet, verified on chain and
credited to the existing Postgres balance (`applyBalanceDelta`); withdrawals are
server-signed transfers to the player's own linked wallet, with a signature stored
before broadcast so a withdrawal can never pay twice. The ledger stays the single
source of truth; the chain is the deposit/withdrawal boundary.

A solpump-style "play from wallet" mode is built on top of these primitives later
(ADR to follow) rather than as a separate money path.

## Consequences

- Scadium is custodial for SOL. Copy must not claim otherwise.
- The hot key is the treasury: plaintext only on a proven non-mainnet cluster; mainnet
  needs a managed signer (not built) and the real-money gate.
- `deposit`/`withdraw`/`settle_bet` in `scadium_vault` become unused by the API; the
  program is left untouched (its $SCAD/term-vault instructions are separate).
- Play-money and real balances share one column, so value transfer between players is
  restricted by economy (spec §7): jackpot and lottery need a deposit.
