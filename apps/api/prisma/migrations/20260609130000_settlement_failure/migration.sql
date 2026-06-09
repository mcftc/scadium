-- CreateTable
CREATE TABLE "SettlementFailure" (
    "id" UUID NOT NULL,
    "gameType" "GameType" NOT NULL,
    "roundId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementFailure_gameType_createdAt_idx" ON "SettlementFailure"("gameType", "createdAt");
