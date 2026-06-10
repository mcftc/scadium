FROM node:20-alpine AS deps
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/fair/package.json ./packages/fair/
COPY packages/ui/package.json ./packages/ui/
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS build
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
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
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/next.config.mjs ./apps/web/next.config.mjs
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["npx", "next", "start", "-p", "3000"]
