# Build from the repo root: docker build -f apps/api/Dockerfile .
# (.dockerignore keeps host node_modules/target/.git out of the context, so the
# install below is deterministic and alpine-native.)
#
# NOTE (#39): the previous three-stage layout (partial-manifest `deps` stage)
# had never actually built — the api postinstall couldn't find the Prisma
# schema, and the per-package pnpm node_modules links never made it into the
# later stages. The CI container-scan job now builds this image on every PR, so
# it can't silently rot again. One full install in the build stage is the
# simple-and-correct trade against broken layer-cache cleverness.
FROM node:20-alpine AS build
# openssl: Prisma's engines need libssl to load on alpine-musl (#81).
RUN apk add --no-cache openssl && npm install -g pnpm@10.33.0
WORKDIR /app
COPY . .
# Install ONLY what the API + worker need (`pkg...` = the package and its
# dependencies). Without this filter the image carries the whole workspace —
# apps/web drags in next, workerd, @next/swc, six copies of viem, three.js,
# lucide-react and react-aria, which took the image to 3.65 GB against the
# `basic` instance type's 4 GB disk. None of it is reachable from the API.
RUN pnpm install --frozen-lockfile --filter "@scadium/api..." --filter "@scadium/worker..."
RUN pnpm --filter @scadium/shared --filter @scadium/fair build
RUN pnpm --filter @scadium/api exec prisma generate
RUN pnpm --filter @scadium/api exec tsc -p tsconfig.json
# @scadium/worker imports the compiled @scadium/api (dist/index.js), so it builds
# after the API. One image now carries BOTH processes — PROCESS_MODE picks which
# run (Cloudflare Containers deploys a single container running `both`).
RUN pnpm --filter @scadium/worker build

FROM node:20-alpine AS runner
# Pick up alpine security fixes newer than the base tag (e.g. libcrypto3 HIGH
# CVEs flagged by the #39 Trivy gate).
# redis: Cloudflare has no managed Redis and Scadium only needs EPHEMERAL coordination
# state (nonces, throttle counters, TTL'd locks, BullMQ), so the entrypoint runs
# redis-server on loopback with persistence off when REDIS_URL is unset. No vendor.
RUN apk upgrade --no-cache && apk add --no-cache openssl redis && npm install -g pnpm@10.33.0
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
# The api's own dependency symlinks (→ the root .pnpm store) — dist/main.js
# cannot resolve @nestjs/* without them, and the entrypoint's `pnpm exec
# prisma` needs the .bin shims.
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
EXPOSE 4000
WORKDIR /app/apps/api
# Entrypoint runs `prisma migrate deploy` before `node dist/main.js`; a migration
# failure aborts the boot (non-zero exit) instead of serving a stale schema.
ENTRYPOINT ["sh", "/app/apps/api/docker-entrypoint.sh"]
