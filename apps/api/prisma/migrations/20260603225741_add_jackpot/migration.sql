-- CreateEnum
CREATE TYPE "JackpotRoundStatus" AS ENUM ('open', 'drawn', 'refunded');

-- CreateTable
CREATE TABLE "JackpotRound" (
    "id" UUID NOT NULL,
    "seedId" UUID NOT NULL,
    "nonce" INTEGER NOT NULL DEFAULT 0,
    "status" "JackpotRoundStatus" NOT NULL DEFAULT 'open',
    "totalLamports" BIGINT NOT NULL DEFAULT 0,
    "winnerId" UUID,
    "winningTicket" BIGINT,
    "payoutLamports" BIGINT NOT NULL DEFAULT 0,
    "closeAt" TIMESTAMP(3) NOT NULL,
    "drawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JackpotRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JackpotEntry" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountLamports" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JackpotEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JackpotRound_status_closeAt_idx" ON "JackpotRound"("status", "closeAt");

-- CreateIndex
CREATE INDEX "JackpotEntry_roundId_idx" ON "JackpotEntry"("roundId");

-- CreateIndex
CREATE INDEX "JackpotEntry_userId_createdAt_idx" ON "JackpotEntry"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "JackpotRound" ADD CONSTRAINT "JackpotRound_seedId_fkey" FOREIGN KEY ("seedId") REFERENCES "Seed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JackpotRound" ADD CONSTRAINT "JackpotRound_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JackpotEntry" ADD CONSTRAINT "JackpotEntry_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "JackpotRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JackpotEntry" ADD CONSTRAINT "JackpotEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
