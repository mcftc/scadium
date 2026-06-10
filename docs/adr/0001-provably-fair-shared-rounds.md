# ADR 0001 — Provable fairness: player seeds vs. shared singleton rounds

**Status:** Accepted (2026-06-10) · Phase I, issue #18 (#93)

## Context

Phase I removes the operator's ability to grind game outcomes. The standard
provably-fair primitive is `result = HMAC-SHA256(serverSeed, clientSeed:nonce)`,
where the server **commits** `sha256(serverSeed)` before play and **reveals**
`serverSeed` after, the **player controls** `clientSeed`, and `nonce` is
monotonic. If the player controls the client seed and the server is committed,
the operator cannot grind: it cannot pick a favourable `serverSeed` after seeing
the (player-chosen) client seed.

This maps cleanly onto **single-player** games. It does **not** map onto games
with a **single shared outcome** for many players.

## Decision

We split fairness into two models:

### 1. Single-player games → player-controlled seed per bet (#92, and future dice/mines/etc.)

The bet derives from the **player's** active client seed + their **monotonic
per-user nonce** (`ClientSeed`, #91) against a committed server seed. Coinflip
(#92) derives from the *joiner's* seed; the per-flip server seed is committed at
create — before the joiner (and their seed) is known — so it cannot be ground.

### 2. Shared singleton rounds → per-round committed/revealed house seed (crash, jackpot, lottery, blackjack table)

A crash round has **one** bust point, a jackpot **one** winning ticket, a lottery
**one** winning number — shared by every participant. A single player therefore
**cannot** control a shared outcome without giving them control over everyone
else's result. So these games keep a **per-round house seed pair**: the
`serverSeedHash` is published when the round opens (before bets), and `serverSeed`
is revealed when it settles. Each player verifies the shared outcome from that
revealed seed.

To make every bet **independently verifiable without a join**, each per-player
`Bet.resultJson` now carries a `fair` block with the round's
`{ serverSeed (post-reveal), serverSeedHash, clientSeed, nonce }` (lottery also
includes `slotHash`). A player can replay the relevant `@scadium/fair` function on
those values and reproduce the shared result their bet was settled against.

We deliberately do **not** fold a per-player client seed into the *derivation* of
a shared outcome: it would either be ignored (misleading — implying it influenced
a result it cannot) or let one player perturb every other player's outcome. The
player's own seed state is always visible at `GET /fairness/seed` and governs
their single-player games.

## Consequences

- Shared-round outcomes remain operator-committed-then-revealed and per-bet
  self-verifiable. The residual trust is that the operator does not grind the
  **house-chosen client seed** at round open (it commits `serverSeed` before bets,
  but picks both seeds).
- Closing that residual gap — unpredictable shared-round entropy the operator
  cannot choose — is tracked separately: **#19** (pin the lottery target slot at
  commit; mark the synthetic off-chain slot-hash path non-fair) and **#20**
  (VRF / slot-pinned `SlotHashes` for on-chain entropy). The lottery already folds
  a `SlotHashes`-derived value into its derivation; crash/jackpot do not yet.
