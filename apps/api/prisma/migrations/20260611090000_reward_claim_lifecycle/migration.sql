-- Phase J (#28): reward-claim custody lifecycle. Claims reserve SCAD instead
-- of debiting it; the debit finalizes only on a confirmed on-chain transfer.

ALTER TABLE "User" ADD COLUMN "scadiumReserved" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "RewardClaim" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE "RewardClaim" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "RewardClaim_status_createdAt_idx" ON "RewardClaim"("status", "createdAt");
