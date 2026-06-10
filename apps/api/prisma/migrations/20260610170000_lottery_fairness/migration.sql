-- Phase I (#19a): lottery entropy provenance flag.
-- 'onchain' = real SlotHashes reveal (provably fair); 'synthetic-not-fair' =
-- operator-deterministic synthetic fallback (NOT fair, surfaced as such).

ALTER TABLE "LotteryDraw" ADD COLUMN "fairness" TEXT;
