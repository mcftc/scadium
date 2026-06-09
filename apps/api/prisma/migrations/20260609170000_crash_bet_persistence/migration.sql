-- Crash bet durable persistence (Phase H #14): a CrashBet row now exists from
-- bet time (not just at settle), so a restart mid-round can refund stranded
-- stake. `remainingLamports` tracks the still-riding portion; `(roundId,userId)`
-- becomes unique so bet/cashout/settle/recovery can upsert by that pair.

ALTER TABLE "CrashBet" ADD COLUMN "remainingLamports" BIGINT NOT NULL DEFAULT 0;

-- Defensive: drop any pre-existing duplicate (roundId,userId) rows (keep the
-- earliest by createdAt, then id) so the unique index below can be created even
-- on dirty dev/test data.
DELETE FROM "CrashBet" a
USING "CrashBet" b
WHERE a."roundId" = b."roundId"
  AND a."userId" = b."userId"
  AND (a."createdAt" > b."createdAt"
       OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

CREATE UNIQUE INDEX "CrashBet_roundId_userId_key" ON "CrashBet"("roundId", "userId");
