-- Drawn jackpot rounds persist every entry's ticket range, so anyone can check
-- that the winning ticket falls in the winner's range (four-games hardening B3).
ALTER TABLE "JackpotRound" ADD COLUMN "rangesJson" JSONB;
