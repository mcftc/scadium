-- CreateEnum
CREATE TYPE "LotteryDrawStatus" AS ENUM ('open', 'drawn');

-- AlterEnum
ALTER TYPE "GameType" ADD VALUE 'lottery';

-- CreateTable
CREATE TABLE "LotteryDraw" (
    "id" UUID NOT NULL,
    "seedId" UUID NOT NULL,
    "nonce" INTEGER NOT NULL DEFAULT 0,
    "status" "LotteryDrawStatus" NOT NULL DEFAULT 'open',
    "mainNumbers" INTEGER[],
    "bonusNumber" INTEGER,
    "potLamports" BIGINT NOT NULL DEFAULT 0,
    "ticketCount" INTEGER NOT NULL DEFAULT 0,
    "drawAt" TIMESTAMP(3) NOT NULL,
    "drawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotteryDraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotteryTicket" (
    "id" UUID NOT NULL,
    "drawId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mainNumbers" INTEGER[],
    "bonusNumber" INTEGER NOT NULL,
    "costLamports" BIGINT NOT NULL,
    "matchedMain" INTEGER NOT NULL DEFAULT 0,
    "matchedBonus" INTEGER NOT NULL DEFAULT 0,
    "payoutLamports" BIGINT NOT NULL DEFAULT 0,
    "won" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotteryTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LotteryDraw_status_drawAt_idx" ON "LotteryDraw"("status", "drawAt");

-- CreateIndex
CREATE INDEX "LotteryTicket_drawId_idx" ON "LotteryTicket"("drawId");

-- CreateIndex
CREATE INDEX "LotteryTicket_userId_createdAt_idx" ON "LotteryTicket"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "LotteryDraw" ADD CONSTRAINT "LotteryDraw_seedId_fkey" FOREIGN KEY ("seedId") REFERENCES "Seed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotteryTicket" ADD CONSTRAINT "LotteryTicket_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "LotteryDraw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotteryTicket" ADD CONSTRAINT "LotteryTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
