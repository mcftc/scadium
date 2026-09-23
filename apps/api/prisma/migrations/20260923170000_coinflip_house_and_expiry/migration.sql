-- Coinflip vs the house, and open-flip expiry (four-games hardening C1).
ALTER TABLE "CoinflipGame" ADD COLUMN "vsHouse" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CoinflipGame" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- Existing open flips get the standard TTL from now, so the first sweep does not
-- cancel a backlog of long-waiting flips the moment this ships.
UPDATE "CoinflipGame" SET "expiresAt" = NOW() + INTERVAL '1 hour' WHERE "status" = 'open';

-- "Recent flips" sorts completed flips by resolvedAt; "my open flips" and the
-- per-user cap read by creator + status; the sweep reads by status + expiresAt.
DROP INDEX IF EXISTS "CoinflipGame_creatorId_idx";
CREATE INDEX "CoinflipGame_status_resolvedAt_idx" ON "CoinflipGame"("status", "resolvedAt");
CREATE INDEX "CoinflipGame_creatorId_status_idx" ON "CoinflipGame"("creatorId", "status");
CREATE INDEX "CoinflipGame_status_expiresAt_idx" ON "CoinflipGame"("status", "expiresAt");
