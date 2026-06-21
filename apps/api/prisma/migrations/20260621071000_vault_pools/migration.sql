-- CreateEnum
CREATE TYPE "VaultAsset" AS ENUM ('scad', 'usds', 'sol', 'usdc');

-- AlterEnum
ALTER TYPE "Currency" ADD VALUE 'scad_vault';

-- CreateTable
CREATE TABLE "VaultPool" (
    "id" TEXT NOT NULL,
    "asset" "VaultAsset" NOT NULL,
    "termDays" INTEGER NOT NULL,
    "totalAssets" BIGINT NOT NULL DEFAULT 0,
    "totalShares" BIGINT NOT NULL DEFAULT 0,
    "indexRay" BIGINT NOT NULL DEFAULT 1000000000000000000,
    "weightBps" INTEGER NOT NULL,
    "aprBps" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastAccrualAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultPosition" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "poolId" TEXT NOT NULL,
    "shares" BIGINT NOT NULL DEFAULT 0,
    "principal" BIGINT NOT NULL DEFAULT 0,
    "maturesAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultEvent" (
    "id" TEXT NOT NULL,
    "userId" UUID,
    "poolId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "assetsDelta" BIGINT NOT NULL,
    "sharesDelta" BIGINT NOT NULL,
    "penaltyAssets" BIGINT NOT NULL DEFAULT 0,
    "indexRayAfter" BIGINT NOT NULL,
    "txSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VaultPool_asset_termDays_key" ON "VaultPool"("asset", "termDays");

-- CreateIndex
CREATE INDEX "VaultPosition_userId_idx" ON "VaultPosition"("userId");

-- CreateIndex
CREATE INDEX "VaultPosition_poolId_idx" ON "VaultPosition"("poolId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultEvent_txSignature_key" ON "VaultEvent"("txSignature");

-- CreateIndex
CREATE INDEX "VaultEvent_userId_idx" ON "VaultEvent"("userId");

-- CreateIndex
CREATE INDEX "VaultEvent_poolId_idx" ON "VaultEvent"("poolId");

-- AddForeignKey
ALTER TABLE "VaultPosition" ADD CONSTRAINT "VaultPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultPosition" ADD CONSTRAINT "VaultPosition_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "VaultPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultEvent" ADD CONSTRAINT "VaultEvent_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "VaultPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: Faz 1 SCAD term pools (asset=scad). `weightBps` mirrors VAULT.TERMS in
-- @scadium/shared (longer term → larger yield-split weight → higher effective
-- APR). Idempotent via the (asset, termDays) unique index.
INSERT INTO "VaultPool" ("id", "asset", "termDays", "weightBps", "updatedAt") VALUES
  ('vault_pool_scad_30',  'scad', 30,  1000, CURRENT_TIMESTAMP),
  ('vault_pool_scad_90',  'scad', 90,  2000, CURRENT_TIMESTAMP),
  ('vault_pool_scad_180', 'scad', 180, 3000, CURRENT_TIMESTAMP),
  ('vault_pool_scad_365', 'scad', 365, 4000, CURRENT_TIMESTAMP)
ON CONFLICT ("asset", "termDays") DO NOTHING;
