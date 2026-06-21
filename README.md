# Scadium

A Solana-based decentralized casino and gaming platform — non-custodial, provably fair, modeled after solpump.io.

## Features (Target)

- **Games**: Crash, Coinflip, Blackjack
- **Non-custodial wallet auth** (Phantom, Backpack, Solflare, Ledger)
- **Provably-fair RNG** (HMAC-SHA256 + on-chain VRF)
- **Real-time chat** (airdrop eligibility)
- **Hourly SOL airdrops** + Daily Case
- **$SCADIUM token** dashboard with buy-and-burn
- **SCAD Engine** (liquid staking → hourly USDS dividends) + **SCAD Vault** (term staking → yield, live earnings)
- **Leaderboards** + **Affiliate** program
- **On-chain bet settlement** via Anchor programs

## Monorepo Layout

```
Scadium/
├── apps/
│   ├── web/              # Next.js 15 frontend
│   ├── api/              # NestJS backend (REST + WebSocket)
│   │   └── prisma/       # Postgres schema + migrations
│   └── worker/           # BullMQ worker (airdrops, leaderboard)
├── packages/
│   ├── shared/           # Shared TS types + zod schemas
│   ├── fair/             # Provably-fair engine
│   └── ui/               # Shared component library
├── programs/             # Anchor (Rust) Solana programs
├── infra/                # Docker compose
└── turbo.json
```

## Requirements

- Node.js ≥ 20
- pnpm ≥ 10
- Docker Desktop (for Postgres + Redis)
- Rust + Solana CLI + Anchor CLI (only for on-chain work — phase 4+)

## Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env template
cp .env.example .env

# 3. Start infra (Postgres + Redis)
docker compose -f infra/docker-compose.yml up -d

# 4. Start dev servers (web + api)
pnpm dev
```

Web: http://localhost:3000 · API: http://localhost:4000 · Swagger: http://localhost:4000/docs

## Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Run all dev servers |
| `pnpm build` | Build all packages |
| `pnpm lint` | Lint everything |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test` | Run unit tests |
| `pnpm format` | Prettier write |

## Roadmap

See [plan file](../.claude/plans/misty-cooking-stearns.md) for the phased roadmap (Phase 0 → 13).

## License

Proprietary — all rights reserved.
