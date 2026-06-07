-- LotteryDraw: hex of the 32-byte slot hash mixed into the draw entropy
ALTER TABLE "LotteryDraw" ADD COLUMN "slotHash" TEXT;

-- LotteryTicket: a bulk buy_tickets tx records N tickets under one signature.
-- txIndex is the ticket's position in the batch; (txSignature, txIndex)
-- replaces the single-column unique and still blocks replays.
DROP INDEX "LotteryTicket_txSignature_key";
ALTER TABLE "LotteryTicket" ADD COLUMN "txIndex" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "LotteryTicket_txSignature_txIndex_key" ON "LotteryTicket"("txSignature", "txIndex");
