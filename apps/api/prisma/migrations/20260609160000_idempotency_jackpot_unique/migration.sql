-- Part B: JackpotEntry unique (roundId, userId).
-- A play-money dev/test DB may hold duplicate (roundId, userId) entries from
-- before this constraint existed; the unique index creation would fail on them.
-- Pre-clean by deleting all but the EARLIEST entry per (roundId, userId). This
-- is acceptable for the current play-money phase (no real funds move) — the
-- aggregate pot is unaffected enough for demo purposes and future entries are
-- rejected at the service layer with a 400.
DELETE FROM "JackpotEntry" a
USING "JackpotEntry" b
WHERE a."roundId" = b."roundId"
  AND a."userId" = b."userId"
  AND (a."createdAt" > b."createdAt"
       OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

-- CreateIndex
CREATE UNIQUE INDEX "JackpotEntry_roundId_userId_key" ON "JackpotEntry"("roundId", "userId");

-- Part C: IdempotencyKey table.
-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "responseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_scope_clientKey_key" ON "IdempotencyKey"("userId", "scope", "clientKey");
