-- Phase G — money-safety backstop (issue #3, ANALYSIS.md §4 Critical #1 & #3).
-- The User balance CHECKs landed in 20260609120000_balance_check_constraints; this
-- completes the set by guaranteeing the airdrop pool columns can never go negative
-- (a negative tip would otherwise drive tipLamports below zero). Idempotent DO-blocks
-- so re-applying is a no-op and this never collides with a constraint added elsewhere.

DO $$
BEGIN
  ALTER TABLE "AirdropPool"
    ADD CONSTRAINT "AirdropPool_tipLamports_nonneg" CHECK ("tipLamports" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "AirdropPool"
    ADD CONSTRAINT "AirdropPool_baseLamports_nonneg" CHECK ("baseLamports" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
