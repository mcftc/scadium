# ADR 0002 — On-chain entropy for non-lottery games

**Status:** Accepted (2026-06-10) · Phase I, issue #20 (#100 spike) · consumed by Phase J

## Context

ADR [0001](./0001-provably-fair-shared-rounds.md) closed most of the fairness gap
but left one residual: for **shared rounds** the operator still picks BOTH the
server seed and the round "client" seed at commit time. It commits
`sha256(serverSeed)` before bets, but because it also chooses the client seed it
can grind the seed *pair* at round open and publish a favourable commitment. The
players cannot detect this. Only `scadium_lottery` mitigates it today — it folds
a **SlotHashes** value (unknown at commit) into its derivation.

Non-lottery games (crash, coinflip, jackpot, blackjack) have **no** on-chain
entropy. Before real money they need entropy the operator **cannot predict or
choose at commit time**, delivered through a flow that Phase J's authoritative
on-chain settlement can consume.

This ADR is the spike decision (#100). The reference integration is #101
(SlotHashes for crash) and #102 (VRF on devnet, blocked on funding).

## Options evaluated

| | ORAO VRF | Switchboard On-Demand | Slot-pinned SlotHashes |
|---|---|---|---|
| Unpredictability | Strong (ed25519 VRF proof, verified on-chain) | Strong (oracle TEE / quorum) | Medium — a slot leader could *grind/withhold* one block; bounded, non-zero |
| Cost / round | Per-request SOL fee | Per-request fee + oracle infra | **Free** (reads a sysvar) |
| Latency | ~1–2 slots (callback) | Pull, ~sub-second | 1 slot (wait for the pinned slot to pass) |
| External dependency | ORAO program + funded payer | Switchboard program + crank/oracle | **None** (native `SlotHashes` sysvar) |
| Devnet/localnet today | Needs oracle + **SOL funding** (blocked) | Needs oracle + funding (blocked) | **Works now** (proven in `scadium_lottery`) |
| Integration weight | Low (CPI request + callback account) | Medium | Low (reuse the lottery slot-pin mechanism) |

## Decision

**Adopt slot-pinned SlotHashes as the entropy baseline now; abstract the entropy
source so a VRF oracle can be swapped in for mainnet later.**

Rationale:
- It is **free, dependency-free, and already proven** on localnet/devnet in
  `scadium_lottery` — it ships without the persistent devnet-funding blocker.
- It removes the operator's commit-time grind: the round **pins a future target
  slot at commit**; the entropy is that slot's hash, which does not exist yet and
  the operator cannot choose. Derivation:
  `finalEntropy = sha256(serverSeed ‖ slotHash ‖ clientSeed ‖ u32le(nonce))`
  (the lottery's existing scheme, generalized).
- Its residual weakness (a slot leader could withhold/grind a single block) is
  acceptable for the play-money demo and is an honest, documented upgrade path —
  **not** a silent compromise. High-stakes/mainnet upgrades to a real VRF.

**VRF choice when we upgrade: ORAO** (lower integration weight than Switchboard
for our request→callback shape). Tracked as #102, blocked on devnet SOL funding +
an oracle budget.

The entropy source is consumed through a single interface so the swap is a
config/flag change, not a rewrite:

```
interface RoundEntropy {
  // pinned at commit; the value is unknown until `targetSlot` passes
  request(roundId): { targetSlot: number, requestId: string }
  // fulfilled after targetSlot (SlotHashes read) OR a VRF callback
  fulfill(roundId): { entropy: 32-byte hex, proof?: string }
}
```

## Commit → request → settle flow

```
open round ─▶ COMMIT            publish sha256(serverSeed); pin targetSlot = currentSlot + Δ;
              │                  persist { entropyRequestId, targetSlot, status: committed }
              ▼
            ENTROPY_REQUESTED    bets accepted during the window
              │
   (targetSlot passes)
              ▼
            ENTROPY_FULFILLED    worker reads SlotHashes[targetSlot] (or VRF callback);
              │                  persist entropy + status; IDEMPOTENT by entropyRequestId
              ▼
            SETTLED              derive result = f(serverSeed, slotHash, clientSeed, nonce);
                                 reveal serverSeed; Phase J settle_bet consumes `entropy`
```

### State machine + idempotency

`committed → entropy_requested → entropy_fulfilled → settled` on the round row
(new `entropyStatus` enum + `entropyRequestId`, `targetSlot`, `entropy` columns).
The fulfillment handler is **idempotent on `entropyRequestId`**: a re-delivered
callback (or a re-run worker job) that finds the round already
`entropy_fulfilled`/`settled` is a no-op, so it can never double-settle.

### Durability (Phase H)

Fulfillment runs as a **durable BullMQ job** in `@scadium/worker` (now built,
Phase H), not an in-process `setTimeout`: enqueue `entropy:fulfill:<roundId>` when
the round commits; the worker polls until `targetSlot` is reached (or the VRF
callback lands), reads the value, and advances the round. A crash/restart re-runs
the idempotent job — no stranded rounds.

### Timeout / fallback

If the entropy is not fulfilled within `ENTROPY_TIMEOUT` (e.g. SlotHashes window
slips, or a VRF callback never lands), the round **voids and refunds** every
debited stake through Phase G's transactional helpers (no funds stranded), writes
a dead-letter row, and does not settle. Documented, deterministic, money-safe.

### Phase J consumption

Phase J's authoritative `settle_bet` reads the persisted `entropy` (and, for VRF,
verifies the on-chain proof account) as the single source of round randomness —
the off-chain mirror ledger only credits after the on-chain settle that consumed
that exact entropy value confirms. The derivation is identical on- and off-chain
(golden-vector locked, as the lottery already does across Rust + `@scadium/fair` +
the browser verifier).

## Consequences

- Ships now, unblocked: crash gets operator-unpredictable entropy via SlotHashes
  behind an env flag (#101); flag off = today's play-money behaviour.
- The VRF upgrade (#102) is a drop-in behind the `RoundEntropy` interface when
  devnet funding / a mainnet oracle budget exists.
- The remaining trust assumption is explicit and small (single-slot leader grind),
  versus today's unbounded operator grind.
