-- AlterTable
ALTER TABLE "LotteryDraw" ADD COLUMN     "commitTxSignature" TEXT,
ADD COLUMN     "drawIndex" BIGINT,
ADD COLUMN     "revealTxSignature" TEXT;

-- AlterTable
ALTER TABLE "LotteryTicket" ADD COLUMN     "free" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payoutUsdtBase" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "prizeTxSignature" TEXT,
ADD COLUMN     "tier" TEXT,
ADD COLUMN     "txSignature" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LotteryDraw_drawIndex_key" ON "LotteryDraw"("drawIndex");

-- CreateIndex
CREATE UNIQUE INDEX "LotteryTicket_txSignature_key" ON "LotteryTicket"("txSignature");

