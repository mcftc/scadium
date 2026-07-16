-- CreateIndex
-- Supports the sitewide live-feed query (recentBets):
--   SELECT ... FROM "Bet" WHERE status IN ('won','lost') ORDER BY "createdAt" DESC LIMIT N
-- Without it, Postgres seq-scans + heap-sorts the fastest-growing table on every
-- (unauthenticated, globally-mounted ticker) page load. The status filter is
-- nearly non-selective, so a bare createdAt index is sufficient.
CREATE INDEX "Bet_createdAt_idx" ON "Bet"("createdAt");
