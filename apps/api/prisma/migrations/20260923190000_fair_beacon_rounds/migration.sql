-- Public randomness beacon (ADR 0004): which drand round each crash round,
-- jackpot round and lottery draw folded in. The 32-byte value itself is stored
-- in `slotHash` (added here for the jackpot, which had no external entropy).
ALTER TABLE "CrashRound" ADD COLUMN "beaconRound" BIGINT;
ALTER TABLE "LotteryDraw" ADD COLUMN "beaconRound" BIGINT;
ALTER TABLE "JackpotRound" ADD COLUMN "beaconRound" BIGINT;
ALTER TABLE "JackpotRound" ADD COLUMN "slotHash" TEXT;
