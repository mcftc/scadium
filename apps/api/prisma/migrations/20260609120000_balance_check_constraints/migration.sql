-- Phase G — money-safety backstop (issue #3, ANALYSIS.md §4 Critical #1 & #3).
-- Non-negativity CHECK constraints on every play-money column. These are a
-- DB-level guarantee that no code path (negative-tip mint, double-spend debit,
-- non-atomic settle) can ever drive a balance or pool below zero — independent
-- of application logic. Raw-SQL migration because Prisma schema does not model
-- CHECK constraints; `prisma migrate deploy` applies it and `migrate dev` will
-- not revert it (Prisma does not manage CHECKs).

ALTER TABLE "User"
  ADD CONSTRAINT "User_playBalanceLamports_nonneg" CHECK ("playBalanceLamports" >= 0);

ALTER TABLE "User"
  ADD CONSTRAINT "User_scadiumBalance_nonneg" CHECK ("scadiumBalance" >= 0);

ALTER TABLE "AirdropPool"
  ADD CONSTRAINT "AirdropPool_tipLamports_nonneg" CHECK ("tipLamports" >= 0);

ALTER TABLE "AirdropPool"
  ADD CONSTRAINT "AirdropPool_baseLamports_nonneg" CHECK ("baseLamports" >= 0);
