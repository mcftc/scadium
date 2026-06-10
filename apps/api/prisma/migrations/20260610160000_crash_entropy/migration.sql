-- Phase I (#20 / #101): on-chain SlotHashes entropy for crash (flag-gated).
-- The round pins a future targetSlot at open and derives its bust from that
-- slot's hash once it passes. All nullable — the play-money default path leaves
-- them null and behaves exactly as before.

ALTER TABLE "CrashRound" ADD COLUMN "entropyStatus" TEXT;
ALTER TABLE "CrashRound" ADD COLUMN "targetSlot" BIGINT;
ALTER TABLE "CrashRound" ADD COLUMN "slotHash" TEXT;
