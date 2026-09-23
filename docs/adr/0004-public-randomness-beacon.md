# ADR 0004 — A public randomness beacon for the shared-round games

**Status:** Accepted (2026-09-23) · four-games hardening B4 · extends [ADR 0002](./0002-onchain-entropy.md)

## Context

Crash, jackpot and lottery results were derived from two seeds the server picks
at round open. The commit (`sha256(serverSeed)`) proves the seed was not changed
afterwards, but it cannot prove the operator did not **know** the result:

- **Crash** — both seeds server-picked, bust fixed at commit: the operator could
  grind or skip busts, and anyone with database read access knew every bust for
  the whole betting window.
- **Jackpot** — the ticket depends on the seeds and the final pot, the only input
  still open at close: an insider can compute, for any extra amount, whether a
  last-second entry wins — sniping without any grinding.
- **Lottery** — with the chain disabled (production), the "slot hash" was a
  synthetic `sha256(serverSeed:clientSeed)`: the winning number was knowable
  before a single ticket sold, while the UI said it came from Solana entropy.

ADR 0002 chose slot-pinned SlotHashes and asked for an entropy abstraction a VRF
could replace. SlotHashes needs a live chain integration (disabled in
production), pins by slot number (drifts against wall-clock close times — a
daily draw cannot pin its slot a day ahead), and has the slot-leader
withholding weakness ADR 0002 already notes.

## Decision

Fold in the **drand quicknet** beacon (League of Entropy; threshold BLS, a new
32-byte value every 3 s, published forever, readable over plain HTTPS from
several independent relays).

Each result uses the **first beacon round published strictly after bets,
entries or sales close** — `beaconRoundAfter(closeTime)`:

| Game | Close time | Result |
| ---- | ---------- | ------ |
| Crash | end of the betting window (pinned + announced at round open) | `crashPointFromSlot(serverSeed, clientSeed, beacon, nonce)` |
| Jackpot | `closeAt` (set by the 2nd player) | `jackpotTicketFromEntropy(serverSeed, clientSeed, beacon, nonce, pot)` |
| Lottery | `drawAt` (sales close) | `lotteryDraw(serverSeed, clientSeed32, beacon, nonce)` |

All three use the existing canonical fold,
`sha256(utf8(serverSeed) ‖ entropy32 ‖ clientSeed32 ‖ u32le(nonce))` — the
beacon value simply takes the place ADR 0002 gave the slot hash, so the lottery's
golden-locked derivation is reused unchanged.

Why this removes foreknowledge: the round number is a pure function of the
close time, so the operator cannot choose it; its value does not exist until
after the betting is over, so nobody — the operator included — can compute a
result while it can still be bet on. The server seed still matters: players
cannot compute the result from the beacon alone until the seed is revealed.

**Failure is never a fallback.** If no relay produces the round in time
(`FAIR_BEACON_WAIT_MS`, default 15 s): crash voids the round and refunds every
stake; the jackpot retries its settle and then refunds; the lottery draw stays
closed and retries. None of them falls back to a value the operator knows.

## Consequences

- Every round stores `beaconRound` and the value (`slotHash`); both are in the
  round's Bet `resultJson.fair`, its result event and its public endpoints.
- The browser verifier fetches the beacon value **from the relays itself** and
  checks the casino's recorded value against it — nothing the casino serves has
  to be trusted. Relay responses are not BLS-verified in-app; a sceptic can
  compare several independent relays (or verify the signature with any drand
  client).
- A crash round now starts running 0–3 s after the window closes (the beacon
  round's publish time + relay latency). Bets are refused from the moment the
  window closes.
- The API needs outbound HTTPS to the relays (the container already has
  internet egress for Neon). `FAIR_BEACON_ENABLED=false` returns to the
  seed-only derivation; the integration suite runs that way and drives the
  beacon through a stub.
- Remaining operator power: it could refuse to run a round after seeing its
  beacon value — a visible void (every stake refunded), not a hidden choice.
- The on-chain paths of ADR 0002 (`scadium_rng`, #101 slot pinning) still take
  precedence where configured; they remain dormant.
