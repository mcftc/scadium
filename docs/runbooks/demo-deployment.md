# Runbook — Live play-money demo on a single VPS (#79–82)

End-to-end checklist to stand up the public **play-money** demo using the prod
Docker Compose stack (`infra/docker-compose.prod.yml` + `infra/Caddyfile`). The
Vercel ISP block does **not** apply — the deploy runs on the VPS over SSH.

Stack: Caddy (auto-HTTPS, the only public ports) → web (Next.js) + api (NestJS) →
Postgres + Redis on the internal network. `app.<domain>` → web, `api.<domain>` → api.

---

## Phase 1 — Provision the host (#80)

- [ ] **VPS** — Hetzner CX22 / DigitalOcean 2 GB+ (the `next build` is the heaviest
      step; **4 GB RAM recommended**, or add swap — see Troubleshooting). Ubuntu 22.04+.
- [ ] **Docker** — install engine + compose plugin:
      ```bash
      curl -fsSL https://get.docker.com | sh
      docker compose version   # must succeed
      ```
- [ ] **Firewall** — allow SSH + 80 + 443 only:
      ```bash
      ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable
      ```
- [ ] **DNS A records** → the VPS IP, **before** first `up` (Caddy's Let's Encrypt
      challenge fails otherwise):
      `app.<domain>` and `api.<domain>`.
- [ ] **Verify resolution:**
      ```bash
      dig +short app.<domain>   # → VPS IP
      dig +short api.<domain>   # → VPS IP
      ```

**Done when:** both names resolve to the VPS and `docker compose version` works.

---

## Phase 2 — Configure & deploy the stack (#81)

- [ ] **Clone:** `git clone https://github.com/mcftc/scadium && cd scadium`
- [ ] **Env:** `cp infra/.env.prod.example infra/.env.prod` and fill in:
  - `DOMAIN=<your domain>`
  - `POSTGRES_PASSWORD` + matching `DATABASE_URL` — `openssl rand -hex 32`
  - `JWT_SECRET` — `openssl rand -hex 32` (API refuses to boot in prod with the dev fallback)
  - `CORS_ORIGIN=https://app.<domain>`
  - `NEXT_PUBLIC_API_URL=https://api.<domain>`, `NEXT_PUBLIC_WS_URL=wss://api.<domain>`
  - Leave on-chain vars (`VAULT_PROGRAM_ID`, `COSIGNER_KEYPAIR_PATH`, …) **unset** →
    play-money mode.
  > `NEXT_PUBLIC_*` are baked into the web bundle at **build** time — changing them
  > later needs a `--build` rebuild of the web image, not just a restart.
- [ ] **Bring it up:**
      ```bash
      docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d --build
      ```
- [ ] **Migrations** apply on API boot (migrate-on-deploy, #16). Confirm:
      ```bash
      docker compose -f infra/docker-compose.prod.yml logs api | grep -i "migration\|Nest application successfully started"
      ```

**Done when:** `docker compose -f infra/docker-compose.prod.yml ps` shows postgres/redis
healthy and api/web/caddy up.

---

## Phase 3 — Verify the live demo (#82)

- [ ] **TLS + reachability:**
      ```bash
      curl -fsS https://api.<domain>/health/live     # {"status":"ok","service":"scadium-api",...}
      curl -fsS https://api.<domain>/api/v1/status   # {"paused":false}
      curl -fsSI https://app.<domain> | head -1      # 200, valid LE cert
      ```
- [ ] **Web loads** — open `https://app.<domain>`: age gate + cookie banner appear (#44/#48),
      footer shows the **play-money** copy (not "instant on-chain settlement", #42/#142).
- [ ] **Auth** — connect a wallet (Phantom/Backpack), sign-in (SIWS) succeeds.
- [ ] **Smoke each game** on the play balance: place a Crash bet, a Coinflip, a Blackjack
      hand, a Jackpot/Lottery entry — balance debits/credits correctly.
- [ ] **Realtime** — Crash ticks stream (Socket.io over `wss://api.<domain>` connects).
- [ ] **Kill-switch** — `POST /api/v1/admin/pause` (admin JWT) → `/api/v1/status` shows
      paused, bets blocked; `POST /api/v1/admin/resume` restores. (See [[incident-response]].)

**Done when:** all four games play end-to-end over HTTPS and realtime works.

---

## Operations

- **Update:** `git pull && docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d --build`
- **Backups:** nightly `pg_dump` to off-box storage (cron):
  ```bash
  docker compose -f infra/docker-compose.prod.yml exec -T postgres \
    pg_dump -U scadium scadium | gzip > /backup/scadium-$(date +%F).sql.gz
  ```
  (For a real-money deploy use managed PG + PITR instead — see [[disaster-recovery]].)
- **Logs:** `docker compose -f infra/docker-compose.prod.yml logs -f api`
- **Restart policy** is `unless-stopped` — the stack survives a reboot.

## Troubleshooting

- **Caddy cert fails / 526:** DNS not propagated yet, or 80/443 blocked. `dig` both
  names, confirm the firewall, wait for propagation, then `docker compose restart caddy`.
- **`next build` OOM (web build killed):** add swap —
  `fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`.
- **API CrashLoop "JWT_SECRET":** the dev fallback is refused in prod — set a real
  `JWT_SECRET`.
- **CORS / WebSocket errors in the browser:** `CORS_ORIGIN` must exactly equal
  `https://app.<domain>` and the web image must have been built with the right
  `NEXT_PUBLIC_*` (rebuild with `--build` if you changed them).

## Scope note

This is the **play-money** demo. Real money requires the full Phase M gate
(`ANALYSIS.md` §9): a completed audit (#51), managed PG + PITR + the Helm/K8s HA
stack (#52), mainnet deploy + multisig (#53), and the compliance/treasury controls
already in code (#56/#146/#149/#54). Do **not** set the on-chain env vars on this host.
