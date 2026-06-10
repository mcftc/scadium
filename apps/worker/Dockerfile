FROM node:20-alpine AS deps
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
COPY packages/fair/package.json ./packages/fair/
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS build
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @scadium/shared --filter @scadium/fair build
RUN pnpm --filter @scadium/api exec prisma generate
# @scadium/worker imports the compiled @scadium/api (dist/index.js), so build the
# API first, then the worker.
RUN pnpm --filter @scadium/api exec tsc -p tsconfig.json
RUN pnpm --filter @scadium/worker build

FROM node:20-alpine AS runner
RUN npm install -g pnpm@10.33.0
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]
