-- CreateEnum
CREATE TYPE "RewardKind" AS ENUM ('wagerReward', 'cashback', 'dailyCase', 'airdrop');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cashbackBaselineLost" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RewardClaim" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "RewardKind" NOT NULL,
    "period" BIGINT NOT NULL,
    "amountScad" BIGINT NOT NULL,
    "txSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RewardClaim_userId_createdAt_idx" ON "RewardClaim"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardClaim_userId_kind_period_key" ON "RewardClaim"("userId", "kind", "period");

-- AddForeignKey
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

