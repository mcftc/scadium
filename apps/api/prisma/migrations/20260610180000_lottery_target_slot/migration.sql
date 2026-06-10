-- Phase I (#19b): pin the lottery draw's target slot at commit time.
-- reveal_draw must derive from THIS slot's SlotHashes entry (not the newest),
-- so the cosigner can't grind the reveal. Null for off-chain / synthetic draws.

ALTER TABLE "LotteryDraw" ADD COLUMN "targetSlot" BIGINT;
