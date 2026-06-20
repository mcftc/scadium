# Build stage — install + build IN-PLACE. The previous split "deps" stage copied
# only the ROOT node_modules into the build stage, but pnpm puts each workspace
# package's deps in its own per-package node_modules (symlinks into .pnpm), so
# @scadium/shared's `zod` was missing at build time (#81). Installing in the same
# stage as the source places every package's node_modules correctly.
FROM node:20-alpine AS build
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY . .
# --ignore-scripts: the web image doesn't use Prisma; running api's postinstall
# (`prisma generate`) here is unnecessary. shared/fair are built explicitly below.
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @scadium/shared --filter @scadium/fair build
# NEXT_PUBLIC_* are inlined into the bundle at build time, so they must be present
# here (not at runtime). Compose passes them via build.args; without these the build
# falls back to the localhost defaults in apps/web/src/config/env.ts.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_SOLANA_NETWORK
ARG NEXT_PUBLIC_SOLANA_RPC
ARG NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_SOLANA_NETWORK=$NEXT_PUBLIC_SOLANA_NETWORK \
    NEXT_PUBLIC_SOLANA_RPC=$NEXT_PUBLIC_SOLANA_RPC \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
RUN pnpm --filter @scadium/web build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@10.33.0
# Copy the whole built workspace so pnpm's symlinked node_modules (root +
# per-package) resolve for `next start`. Symlinks are relative within /app and are
# preserved across the stage copy.
COPY --from=build /app ./
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["pnpm", "exec", "next", "start", "-p", "3000"]
