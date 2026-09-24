# Wallet custody (Phase 1) — implementation plan

Spec: `docs/superpowers/specs/2026-09-24-wallet-custody-design.md` · ADR 0005.
Owner approved executing end to end without per-step approval (2026-09-24).

## Tasks

1. **Schema** — migration `20260924120000_custody_transfers`: `User.fundedAt` (from
   `vaultAddress`, then drop it); `VaultTransfer` → `CustodyTransfer` with status
   lifecycle columns; `ScanCursor`.
2. **Config + chain seam** — `custody.config.ts` (env parse, defaults), `custody-chain.ts`
   (interface + web3.js impl + cluster proof + key parsing), unit tests.
3. **Economy rules** — `economy.ts`; wire E1–E6 into jackpot, lottery, coinflip,
   airdrop, race, affiliates; unit + integration tests.
4. **Deposits** — verify/record/credit/hold/convert/scan/retry; integration tests with a
   fake chain.
5. **Withdrawals** — request/process/retry/refund state machine; integration tests.
6. **API surface** — controller, `/me.funded`, job `custody` (registry, runner, worker
   schedule), reconcile solvency replaces `fundedDrift`; remove the vault bridge.
7. **Chain integration** — local validator in docker-compose + CI; real round-trip tests.
8. **Web** — `/wallet` rebuild, banner, balance label, jackpot/lottery/coinflip states.
9. **Worker/deploy config** — forward `CUSTODY_*` + `SOLANA_RPC_URL`, drop dead
   `SOLANA_RPC`/`HOUSE_WALLET_SECRET_KEY` forwarding; runbook + `.env.example`.
10. **Gate** — fresh-DB migrate, typecheck, lint, all test suites, builds, secret scan;
    one review pass; commit + push.
11. **Devnet rollout** — hot wallet, faucet funding, secrets, deploy once, scripted live
    round trip, docs (CHANGELOG, BACKLOG, CLAUDE.md, memory).
