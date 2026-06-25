# Build from the repo root: docker build -f apps/worker/Dockerfile .
# Mirrors apps/api/Dockerfile's proven full-install pattern. The previous partial
# "deps" stage copied only package.json files, so apps/api's `prisma generate`
# postinstall ran before the schema existed and `pnpm install` failed ("Could not
# find Prisma Schema"). One full install in the build stage is simple-and-correct;
# openssl is needed for Prisma's engines on alpine-musl.
FROM node:20-alpine AS build
RUN apk add --no-cache openssl && npm install -g pnpm@10.33.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @scadium/shared --filter @scadium/fair build
RUN pnpm --filter @scadium/api exec prisma generate
# @scadium/worker imports the compiled @scadium/api (dist/index.js), so build the
# API first, then the worker.
RUN pnpm --filter @scadium/api exec tsc -p tsconfig.json
RUN pnpm --filter @scadium/worker build

FROM node:20-alpine AS runner
RUN apk upgrade --no-cache && apk add --no-cache openssl && npm install -g pnpm@10.33.0
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
# @scadium/worker → requires @scadium/api (dist) → which needs the api's own
# dependency symlinks (@nestjs/*, prisma, etc.) to resolve at runtime.
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]
