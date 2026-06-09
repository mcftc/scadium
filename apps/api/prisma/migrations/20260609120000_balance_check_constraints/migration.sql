-- Last-line money-safety backstop for Phase G: a play-balance debit must never
-- persist a negative balance even if an application guard is ever bypassed.
-- Added idempotently because the negative-tip task (#3, PR #57) may introduce
-- the same playBalanceLamports CHECK; whichever migration applies first wins
-- and the other becomes a no-op (re-running is safe).

DO $$
BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_playBalance_nonneg" CHECK ("playBalanceLamports" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_scadiumBalance_nonneg" CHECK ("scadiumBalance" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
