-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Currency" ADD VALUE 'scad_staked';
ALTER TYPE "Currency" ADD VALUE 'usds';

-- AlterEnum
ALTER TYPE "RewardKind" ADD VALUE 'dividend';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "scadiumStaked" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "stakeLockedUntil" TIMESTAMP(3),
ADD COLUMN     "usdsBalance" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "usdsReserved" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StakeEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amountScad" BIGINT NOT NULL,
    "stakedAfter" BIGINT NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StakeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributionRound" (
    "id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "ngrLamports" BIGINT NOT NULL DEFAULT 0,
    "poolUsds" BIGINT NOT NULL DEFAULT 0,
    "totalStakedSnapshot" BIGINT NOT NULL DEFAULT 0,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "distributed" BOOLEAN NOT NULL DEFAULT false,
    "distributedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistributionRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributionClaim" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "stakedAmount" BIGINT NOT NULL,
    "shareUsds" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistributionClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StakeEvent_userId_createdAt_idx" ON "StakeEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DistributionRound_period_key" ON "DistributionRound"("period");

-- CreateIndex
CREATE INDEX "DistributionRound_createdAt_idx" ON "DistributionRound"("createdAt");

-- CreateIndex
CREATE INDEX "DistributionClaim_userId_createdAt_idx" ON "DistributionClaim"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DistributionClaim_roundId_userId_key" ON "DistributionClaim"("roundId", "userId");

-- AddForeignKey
ALTER TABLE "StakeEvent" ADD CONSTRAINT "StakeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributionClaim" ADD CONSTRAINT "DistributionClaim_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "DistributionRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributionClaim" ADD CONSTRAINT "DistributionClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

