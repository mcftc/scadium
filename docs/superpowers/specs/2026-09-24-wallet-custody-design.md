# Wallet custody — deposit, play, withdraw with a real wallet (devnet)

**Status:** Accepted 2026-09-24 · Phase 1 of "players play from their wallets" · ADR [0005](../../adr/0005-custodial-site-balance.md)

## 1. Goal

A player connects a real Solana wallet (Phantom / Solflare in devnet mode), deposits
test SOL, plays the live games with it, and withdraws it back to the same wallet —
end to end on **devnet**, on the live site, with automated tests against a real local
validator. No real money: `REAL_MONEY_ENABLED` stays off and mainnet stays refused.

**Phase 2 (separate spec, after this ships):** a solpump-style "play from wallet"
mode composed from this phase's primitives (stake pulled per bet, payout
auto-withdrawn). **Out of scope:** mainnet, the Anchor programs, $SCAD/USDS claims,
per-user deposit addresses (exchange deposits), KMS signing.

## 2. Decisions (owner, 2026-09-24)

| Question | Decision |
| --- | --- |
| Target | Devnet end to end; mainnet is a separate, later, legal decision |
| Money model | Site balance first (custodial), wallet mode on top later |
| Environment | The live site (scadium.com) moves to devnet deposits |
| Play-money | Kept for non-depositors; the first deposit converts the account |

**Amendment (correctness, found while designing):** a single shared balance lets
free play-money flow into a withdrawable balance through anything that moves value
between players — pooled games, PvP, tips, referral commission, and positions or
perks carried across the conversion. §7 lists the rules that stop it. The visible
cost: **jackpot and lottery need a deposit** (one shared pot each, so they cannot
mix balances); play-money users keep crash and coinflip.

## 3. Why the existing vault path is replaced

The unused vault-program flow (user-owned PDA + `settle_bet`) cannot hold real value:
- `withdraw` needs only the owner's signature and `settle_bet` has no callers, so a
  loser withdraws their stake; even with per-bet settles a withdrawal can front-run
  the settle, which then reverts.
- `settle_bet` takes the stake/payout from the cosigner, so the server key can drain
  any user vault — the "non-custodial" claim did not hold either way.

A custodial site balance (bc.game / Stake model) keeps the games unchanged, needs no
program deploy, and is what ADR 0003's off-chain-first engine already assumes.

## 4. Architecture

New module `apps/api/src/custody/` (global):

| Unit | Responsibility |
| --- | --- |
| `custody.config.ts` | Parse + validate every setting (§9); `enabled` = configured |
| `custody-chain.ts` | The only Solana I/O: genesis hash, balance, tx fetch, signature history, sign/send, status. One interface, a web3.js implementation, an in-memory fake for DB tests |
| `deposit.service.ts` | Verify a deposit tx, record it, credit or hold it, convert on first credit, scan the treasury history, retry holds |
| `withdrawal.service.ts` | Request (debit + row), process (sign → store → send → confirm), retry, refund |
| `economy.ts` | Play vs real rules (plain functions) used by games, airdrop, race, affiliates (§7) |
| `custody.controller.ts` | REST (§8) |
| `custody-jobs` | Queue `custody` (worker, 1 min) + the hourly cron: scan, retry holds, resume withdrawals |

Removed: `solana/vault-bridge.service.ts`, the deposit/withdraw/balance routes of
`solana/vault.controller.ts` (`GET /vault/config` stays — the site's chain flag),
`reconciliation.fundedDrift`, and the web vault tx builders. The Anchor programs are
not touched.

### 4.1 Safety gates (all fail closed)

1. **Cluster proof.** At boot the API reads the RPC's genesis hash and maps it to a
   cluster. Custody activates only when it equals `SOLANA_NETWORK`. A mainnet hash
   additionally requires the real-money gate *and* a managed key — neither exists, so
   mainnet custody cannot start. A wrong RPC URL can never move real money.
2. **Hot key.** `CUSTODY_HOT_WALLET_SECRET_KEY` (Worker secret → container env; never
   in the repo). A plaintext key is accepted only on a proven devnet/testnet/localnet.
3. **Configured ≠ active.** `CUSTODY_ENABLED` turns on the economy rules even while the
   chain is unreachable; deposits/withdrawals return 503 until the cluster is proven.
4. **Solvency.** A withdrawal waits (never fails) while the hot wallet cannot cover it
   plus the fee reserve; the reconcile job alerts when hot balance < liabilities.
5. **Emergency stop = the global pause** (#56): holds deposits, refuses withdrawals,
   signs nothing new. `CUSTODY_ENABLED=false` would also lift the economy rules, so it
   is not a stop switch.

## 5. Data model

- `User.fundedAt DateTime?` — set by the first credited deposit; replaces the unused
  `vaultAddress` (dropped, NOT carried over: an old vault's SOL is still in the owner's
  PDA, so marking them funded would make their balance withdrawable twice).
- `VaultTransfer` → **`CustodyTransfer`**, one row per value movement either way:
  `kind` deposit|withdraw · `status` · `userId?` (unattributed deposits) · `wallet`
  (sender / destination) · `amountLamports` · `txSignature? @unique` · `slot?` ·
  `lastValidBlockHeight?` · `attempts` · `heldReason?` · `error?` ·
  `settledAt?` · timestamps.
  - deposit: `held` → `credited`
  - withdraw: `pending` → `sent` → `confirmed` | back to `pending` (dead signature) | `failed` (refunded)
- `ScanCursor { key @id, signature, slot, updatedAt }` — treasury scan position.

## 6. Flows

### 6.1 Deposit
1. Web builds `SystemProgram.transfer(wallet → treasury)`, the wallet signs and sends,
   then `POST /custody/deposits { signature }`.
2. API fetches the tx at `CUSTODY_COMMITMENT` (default `finalized`). Not yet there →
   `{status:'pending'}`, the web polls. Verification uses **balance deltas**, not
   instruction parsing: `meta.err` null, treasury is not a signer, treasury
   `post − pre > 0` is the amount. The sender is the signer that is a user's primary or
   linked wallet: exactly one account → it; none → `unattributed` (retried as wallets
   get linked); several → `ambiguous_sender`, never auto-credited.
3. The row is inserted once (`txSignature` unique → replays are no-ops), then credited
   in one serializable tx, or held with a reason:
   `unattributed`, `ambiguous_sender`, `below_minimum`, `paused`, `deposit_limit`, `age_unverified`,
   `open_play_positions`.
   Every scan retries holds (a user may link the wallet or settle their bets later).
4. **Conversion** (first credit, same tx): zero the play balance, forfeit unclaimed
   referral commission, reset the free-ticket baseline, set `fundedAt`.
5. **Scanner** (job + `POST /custody/deposits/scan`): `getSignaturesForAddress`
   from the cursor, oldest first, same record/credit path. Transfers below the
   minimum from unknown wallets create no row (dust cannot fill the database).

### 6.2 Withdrawal
1. `POST /custody/withdrawals { amountLamports, wallet? }` (Idempotency-Key): funded
   only; destination = the user's primary or a linked wallet; min / max / daily cap;
   one in-flight withdrawal per user. Debit + `pending` row in one serializable tx.
2. Processor (inline after commit, and the job for anything left):
   - `pending`: skip while the hot wallet cannot cover it. Build transfer + memo
     `scadium:w:<id>`, sign, **store `txSignature` + `lastValidBlockHeight` (CAS
     `pending → sent`) before broadcasting**, then send.
   - `sent`: finalized height first, then signature status with history search.
     Landed at the commitment without error → `confirmed`. Failed at the commitment
     (no value moved), or not found once the **finalized** block height passed
     `lastValidBlockHeight` + `CUSTODY_EXPIRY_MARGIN_BLOCKS` → the signature is dead:
     back to `pending` (attempt + 1), or `failed` + refund after `CUSTODY_WITHDRAW_MAX_ATTEMPTS`.
3. **No double pay:** a row has at most one live signature; a new one is signed only
   after the previous is provably dead, and a refund happens only then. (This is the
   C4 bug's fix pattern: never restore on "maybe".)

## 7. Economy rules (only while `CUSTODY_ENABLED`)

"Real" = `fundedAt` set. Nothing may move value from play to real.

| # | Where | Rule |
| --- | --- | --- |
| E1 | jackpot enter, lottery buy + free ticket; blackjack bet | real only; jackpot/lottery also refused while the round/draw still holds play entries (the cutover leftovers). Blackjack because its seats live in memory between debit and saved state, where E6 cannot see them |
| E2 | coinflip join | joiner's economy must equal the creator's (checked in the join tx). Create / vs-house: anyone |
| E3 | airdrop | tip and eligibility: play only (the pool is a play promotion); payees re-checked under row locks inside the payout tx |
| E4 | daily race | board and prizes: play only (fixed play-money pool); re-checked inside each prize tx |
| E5 | referral commission | accrues only when referrer (row-locked) and referee share an economy; conversion forfeits the unclaimed rest |
| E6 | conversion | held while the user has an open play position (crash bet, open flip, jackpot entry, lottery ticket, blackjack seat, instant round) |
| E7 | withdrawal | real only |

Crash and coinflip vs the house are house-banked and stay open to both. $SCAD /
USDS accrual is untouched (not withdrawable through custody).

## 8. API

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /custody/config` | — | enabled, active, cluster, treasury, limits, commitment |
| `GET /custody/transfers` | JWT | own deposits + withdrawals (paged) |
| `POST /custody/deposits` | JWT, KYC | confirm one signature |
| `POST /custody/deposits/scan` | JWT, throttled | scan now (after a wallet send the tab lost) |
| `POST /custody/withdrawals` | JWT, KYC, idempotent | request |

`/me` gains `funded`.

## 9. Settings (API env; defaults documented in the runbook)

| Setting | Default | Notes |
| --- | --- | --- |
| `CUSTODY_ENABLED` | `false` | also switches on §7 |
| `CUSTODY_HOT_WALLET_SECRET_KEY` | — | base58 or JSON array; secret |
| `CUSTODY_COMMITMENT` | `finalized` | `confirmed` allowed off mainnet |
| `CUSTODY_MIN_DEPOSIT_LAMPORTS` | 0.01 SOL | |
| `CUSTODY_MIN_WITHDRAW_LAMPORTS` | 0.01 SOL | |
| `CUSTODY_MAX_WITHDRAW_LAMPORTS` | 10 SOL | per request |
| `CUSTODY_DAILY_WITHDRAW_LAMPORTS` | 25 SOL | per user per UTC day |
| `CUSTODY_FEE_RESERVE_LAMPORTS` | 0.01 SOL | kept in the hot wallet for fees |
| `CUSTODY_WITHDRAW_MAX_ATTEMPTS` | 5 | dead signatures before refund |
| `CUSTODY_EXPIRY_MARGIN_BLOCKS` | 150 | past expiry before an unseen signature is dead |
| `CUSTODY_SCAN_PAGE` | 1000 | signatures per history page |
| `SOLANA_NETWORK` / `SOLANA_RPC_URL` | devnet / derived | existing; the container now receives `SOLANA_RPC_URL` (it was sent as `SOLANA_RPC`, which nothing reads) |

## 10. Web

- `/wallet` rebuilt: deposit (amount → wallet signs a transfer → status until
  credited), withdraw (amount, linked wallet → live status), history with explorer
  links for the right cluster, devnet guide (Phantom Testnet Mode / Solflare Devnet,
  faucet), play-money conversion warning, hold reasons in plain words.
- Site banner while custody is on and the cluster is not mainnet: test SOL, no value.
- Balance pill labels play vs test SOL; jackpot/lottery show "deposit to play" for
  play users; the coinflip lobby marks which flips you can join.

## 11. Testing

- **Unit:** config parsing/defaults, cluster mapping, deposit classification from tx
  fixtures, withdrawal state transitions, economy rules.
- **Integration (Postgres, fake chain):** credit/replay/hold/retry, conversion side
  effects, open-position hold, withdraw lifecycle incl. dead-signature retry, refund
  after max attempts, concurrent requests, every E-rule at its real call site.
- **Chain integration (real local validator in Docker):** deposit → scan → credit,
  withdraw → send → confirm, expired signature → retry. Runs in the integration suite
  and CI.
- **Live devnet check:** a scripted user (keypair, SIWS) deposits, plays coinflip vs
  the house, withdraws; balances reconciled on the explorer.

## 12. Rollout

1. Generate the devnet hot wallet locally; fund it from the devnet faucet.
2. Worker secret + vars (`CUSTODY_ENABLED=true`, network devnet); deploy API + web once.
3. Verify: cluster proven in logs, `GET /custody/config` active, scripted round trip,
   no `SettlementFailure`, solvency log clean.

## 13. Deferred (BACKLOG)

Phase 2 wallet mode; mainnet (licence, KMS signer, dedicated RPC, exchange deposits
via memo or per-user addresses, withdrawal review queue, bankroll-aware crash
exposure); a devnet faucet button; real-money budgets for race/airdrop.
