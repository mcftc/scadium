-- #H18: track claimed affiliate commission so accrued commission is collectible.
ALTER TABLE "Referral" ADD COLUMN "commissionClaimedLamports" BIGINT NOT NULL DEFAULT 0;
