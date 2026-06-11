# House bankroll model (#30)

The `house_vault` PDA is the funded bankroll: once `settle_bet` moves real value (#26),
every net win is paid from it. This document sizes that bankroll, defines the limits the
code enforces, and states the operational rules. Constants live in
`packages/shared/src/constants.ts` (`HOUSE`); changing the policy means changing them there.

## Worst-case payout per game

| Game      | Banked by | Uncapped worst case                                       | Effective worst case (with caps) |
| --------- | --------- | --------------------------------------------------------- | -------------------------------- |
| Crash     | **House** | 100 SOL max bet × 1,000,000× max cashout = 100M SOL       | `MAX_WIN_PER_BET` = **50 SOL** per bet |
| Blackjack | **House** | 100 SOL seat × `BLACKJACK.MAX_PAYOUT_X` (100×, dominated by 21+3 suited-trips; main worst is 4 split hands doubled = 16×) | `MAX_WIN_PER_BET` = **50 SOL** per seat |
| Coinflip  | PvP       | none — the pot is both players' stakes; the winner gets 1.9× stake and the house keeps the 0.1× edge | **0** house exposure |
| Jackpot   | Pooled    | none — the winner is paid from the entries collected that round (minus fee) | **0** house exposure |
| Lottery   | Pooled ($SCAD) | prize brackets are funded from ticket sales into the lottery treasury | **0** SOL exposure; the treasury solvency guard + budgeted prize sweep (#29) bound the $SCAD side |

No bankroll covers crash's raw 162,000×+ multipliers — real books cap the **win**, not the
multiplier. `HOUSE.MAX_WIN_PER_BET_LAMPORTS` (50 SOL) is that anchor: the maximum the house
can lose to a single bet, regardless of stake × multiplier.

## Enforced limits

1. **Rent floor (on-chain, hard stop).** `settle_bet` never pays a net win that would take
   `house_vault` below `Rent::minimum_balance(0)` = 890,880 lamports
   (`programs/scadium_vault/src/lib.rs`). A breaching win reverts with `InsufficientFunds`;
   the vault can never go under-rent or negative.
2. **Per-bet max win (API).** `ExposureGuard.potential()` caps any single bet's potential
   payout at `MAX_WIN_PER_BET_LAMPORTS` (50 SOL).
3. **Per-round exposure cap (API).** At the start of each betting window the engine
   snapshots the live `house_vault` balance; the sum of potential payouts accepted into the
   round may not exceed `MAX_ROUND_EXPOSURE_BPS` (2,000 bps = **20%**) of that snapshot.
   Over-cap bets are rejected at acceptance (`apps/api/src/common/exposure-guard.ts`,
   wired into the crash and blackjack engines — the two house-banked games).
4. **Solvency monitor (worker).** Each reconcile sweep publishes
   `scadium_house_vault_lamports` and raises `scadium_low_bankroll_alerts_total` + an error
   log when the vault drops below `rent floor + MIN_BANKROLL_BUFFER_LAMPORTS` (1 SOL)
   (`ReconciliationService.houseSolvency`).

## Minimum funded bankroll

- **Hard minimum** (script-enforced by `scripts/init-house.ts`):
  `rent floor + MIN_BANKROLL_BUFFER` ≈ **1.0009 SOL**. Below this the init script refuses
  to run and the monitor alerts.
- **Full coverage** (default float when `HOUSE_FLOAT_SOL` is not set):
  `MAX_WIN_PER_BET / (MAX_ROUND_EXPOSURE_BPS / 10,000) + rent floor` =
  50 / 0.20 ≈ **250 SOL**. At this size a single max win (50 SOL) fits inside one round's
  20% cap, so the cap never limits play below the advertised max win.
- **Between the two** the system stays solvent but degrades gracefully: the 20% round cap
  scales down with the bankroll (e.g. a 10 SOL vault accepts at most 2 SOL of potential
  payout per round), so a drained vault self-limits instead of stranding winners.

Worst-case drain per round is bounded by `20% of the live bankroll` — even a maximally
unlucky streak geometrically decays the bankroll rather than zeroing it, and the rent floor
is unreachable by settlement.

## Hot / cold split

The cosigner hot key signs every settlement and lives in the API process
(`ANALYSIS.md` §5 High #10) — treat `house_vault` as a **hot** wallet:

- Keep at most ~full coverage (250 SOL) in `house_vault`; excess profit should be swept to
  a cold authority wallet (manual today; Phase K hardens the cosigner story).
- Top-ups flow cold → hot via `scripts/init-house.ts`, which asserts the float against this
  model instead of a hardcoded number.
- The lottery treasury reserve (#29) is sized separately on the $SCAD side and is not part
  of the SOL bankroll.

## Pointers

- Constants: `packages/shared/src/constants.ts` → `HOUSE`
- Guard: `apps/api/src/common/exposure-guard.ts` (+ unit spec alongside)
- On-chain floor: `programs/scadium_vault/src/lib.rs` `settle_bet` (+ `tests/scadium_vault.ts`)
- Monitor: `apps/api/src/reconciliation/reconciliation.service.ts` `houseSolvency()`
- Float derivation: `scripts/init-house.ts`
