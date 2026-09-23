# Four-games hardening — Crash, Coinflip, Jackpot, Lottery

**Date:** 2026-09-23 · **Source:** the four code-verified game audits run on 2026-09-23
(findings cite `file:line`; every premise is re-verified against the code before it is fixed).
**Scope:** everything in tiers A–D below. Order: A → C → B → D. Commit + push per item after
its tests pass; **deploy once**, after the whole plan is done and the full local gate is green.

Principle for all of it: the money cores (claim-gated serializable settles, guarded debits,
boot recovery) are sound and stay untouched in shape. The fixes live at the seams —
restarts, retries, timers, sockets — most of which the Cloudflare sleep/restart model exposed.

## Tier A — live bugs

| # | Fix | Reuses / extends | Locked by |
|---|---|---|---|
| A1 | **Lottery H8.** Boot recovery settles only draws whose `drawAt <= now`; an open draw with a future `drawAt` is *resumed* (tallies rebuilt from its tickets, timer re-armed) instead of drawn. | `recoverStrandedDraws` | e2e: future-`drawAt` draw survives recovery, is resumed, then settles on time |
| A2 | **Crash duplicate bet.** A second bet for the same (round, user) is rejected *inside* the debit tx (`createMany` inserted 0 rows → throw → debit rolls back), so the refund path can never delete the accepted bet's `CrashBet` row. `engine.placeBet` also rejects a stale round id. | `crash.service.placeBet` | e2e: 2 concurrent bets, balance for 2 → 1 accepted, row survives, cash-out persists |
| A3 | **Loop liveness.** One `resume()` per engine (recover + open) guarded by a loop generation so stale timers are no-ops; settle retried with backoff, then a fallback (crash: recovery refund; jackpot: forced refund; lottery: keep retrying); a watchdog resumes a stalled loop; every fire-and-forget loop promise gets a catch. Leader-election renew no longer flickers to non-leader mid-reacquire. | engines' existing recovery paths | unit (fake timers) + e2e: induced settle failure → next round opens |
| A4 | **Crash drain on SIGTERM.** `beforeApplicationShutdown` stops new bets, refunds queued next-round bets, lets the in-flight round bust and settle (bounded), and opens no new round. The client explains a voided round instead of silently losing the bet. | Nest shutdown hooks already enabled | e2e: shutdown mid-round settles it, no new round |
| A5 | **Settle transaction budget.** Settles pass an explicit, config-driven timeout/maxWait instead of Prisma's 5 s default; the lottery settle aggregates per user (the unbounded case: bulk buyers). | `withSerializable` (optional options arg) | e2e: 1,000-ticket lottery settles |
| A6 | **Reconnect resync, all four games.** Refetch on socket reconnect, a visible reconnecting state (crash disables cash-out while disconnected), crash snapshot ordering guard, lottery `drawId` guard, coinflip modal driven by the join response. Jackpot recovery re-arms a round whose `closeAt` is still ahead. | `socket-provider` | web unit tests where the hook is testable |
| A7 | **Budget counts socket-held time.** The container Durable Object charges *running* time from a heartbeat scheduled via the library's `schedule()`, and stops the container once the daily cap is spent; the edge gate only reads it. Crash cash-out stays reachable past the cap. | `consumeActiveBudget` | worker unit test of the accounting fn |

## Tier C — playable on a quiet site

| # | Fix |
|---|---|
| C1 | **Coinflip vs house** (`vsHouse` flip: resolved at once against the house at the same 1.9×, outcome from the *creator's* seed + nonce, triggered only by the creator so the operator never selects), **open-flip expiry** (TTL + cron sweep through the existing cancel CAS/refund), **`GET /coinflip/mine`**, per-user open-flip cap. |
| C2 | **Jackpot countdown starts at the 2nd distinct player**; a lone entry waits (bounded by a max wait, then refunded); "Recent winners" shows drawn rounds only. |
| C3 | **Lottery bulk buy** in one request charging the advertised bulk price once; quantity capped at `maxTicketsPerPurchase`; SOL shown in play-money mode. |
| C4 | **Jackpot reveal** driven by the settle's ordered player list; "You won" only when `winnerId === me`. |

## Tier B — real-money blockers

| # | Fix |
|---|---|
| B1 | **Affiliate commission on the house edge**, not the stake (`stake × edge(game) × tierRate`, the bc.game formula), with a two-account coinflip-ring invariant test. |
| B2 | **Crash max-win cap** applied to payouts (forced exit at the capping multiplier) and **honest RTP** derived from the bust formula, guarded by a Monte-Carlo EV test. |
| B3 | **Jackpot ticket→winner verifiability**: the settle persists the ordered ranges; each Bet carries its own range; the browser verifier recomputes ticket *and* winner. |
| B4 | **No operator foreknowledge** in crash, jackpot and lottery: results fold in a **drand quicknet** beacon round that is published only *after* bets/entries/sales close (ADR 0004). Browser verifier checks the beacon value against a public relay. |
| B5 | Coinflip emits after commit; lottery free-ticket redemption is one guarded UPDATE; open-flip stakes count toward RG limits and self-exclusion cancels open flips. |

## Tier D — polish

| # | Fix |
|---|---|
| D1 | Crash history loaded from the DB on boot; history chips deep-link to the verifier. |
| D2 | Crash auto-bet on the shared `useAutoBet` engine (rounds, stop on profit/loss, on-win/on-loss). |
| D3 | Crash hotkeys (Space = bet / cash out). |
| D4 | Mobile coinflip lobby as cards; creator is shown their result when a flip resolves; "Win X" preview. |
| D5 | Crash and jackpot broadcasts carry a display handle and an opaque player id, never `userId` or the full wallet. |

## Out of scope (recorded, not silently dropped)
H6 faucet guard and H7 on-chain seal (dormant chain paths, need a program change), the
dormant scadium_rng ordering issues, and the coinflip DB-read snipe (needs post-join entropy).
