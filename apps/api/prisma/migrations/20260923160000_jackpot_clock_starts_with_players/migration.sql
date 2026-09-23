-- The jackpot clock now starts with its players, not at round open: a round
-- waits (closeAt NULL) until the first entry, which sets a solo deadline, and
-- the MIN_PLAYERS-th distinct player sets the real countdown.
ALTER TABLE "JackpotRound" ALTER COLUMN "closeAt" DROP NOT NULL;
