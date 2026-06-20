-- Last-line money-safety backstops (#222), completing the set started by
-- 20260609120000_balance_check_constraints (which covered playBalanceLamports +
-- scadiumBalance). The reservation-based reward/dividend claim paths move value
-- into `*Reserved` columns and decrement `usdsBalance`, but those columns had no
-- DB CHECK — so a hypothetical bypassed application guard could persist a negative
-- balance / inflated reserve (this asymmetry was flagged reviewing #214). Add the
-- non-negative CHECKs so the database is the final backstop, matching the existing
-- playBalanceLamports / scadiumBalance constraints. Idempotent (duplicate_object →
-- no-op) so re-running is safe.

DO $$
BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_usdsBalance_nonneg" CHECK ("usdsBalance" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_scadiumReserved_nonneg" CHECK ("scadiumReserved" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_usdsReserved_nonneg" CHECK ("usdsReserved" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
