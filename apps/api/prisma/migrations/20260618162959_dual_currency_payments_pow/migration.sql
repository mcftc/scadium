-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('jeton', 'scad');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('stripe', 'moonpay', 'transak', 'solana_pay', 'google_play', 'apple_iap');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('pending', 'paid', 'fulfilled', 'refunded', 'failed', 'chargeback');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GameType" ADD VALUE 'dice';
ALTER TYPE "GameType" ADD VALUE 'limbo';
ALTER TYPE "GameType" ADD VALUE 'wheel';
ALTER TYPE "GameType" ADD VALUE 'plinko';
ALTER TYPE "GameType" ADD VALUE 'mines';
ALTER TYPE "GameType" ADD VALUE 'hilo';
ALTER TYPE "GameType" ADD VALUE 'tower';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RewardKind" ADD VALUE 'tournament';
ALTER TYPE "RewardKind" ADD VALUE 'promo';

-- AlterTable
ALTER TABLE "BalanceLedger" ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'jeton';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authProvider" TEXT NOT NULL DEFAULT 'siws',
ADD COLUMN     "custodial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "privyUserId" TEXT;

-- CreateTable
CREATE TABLE "Purchase" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerRef" TEXT NOT NULL,
    "jetonLamports" BIGINT NOT NULL DEFAULT 0,
    "priceCurrency" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'pending',
    "channel" TEXT NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Purchase_userId_createdAt_idx" ON "Purchase"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_provider_providerRef_key" ON "Purchase"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "User_privyUserId_key" ON "User"("privyUserId");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

