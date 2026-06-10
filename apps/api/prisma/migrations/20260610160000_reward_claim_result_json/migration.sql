-- #22: provably-fair daily case — persist the fairness trail on the claim.
-- Nullable, no backfill: pre-existing claims were rolled with Math.random()
-- and have no seed context to record.
ALTER TABLE "RewardClaim" ADD COLUMN "resultJson" JSONB;
