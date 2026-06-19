-- CreateTable
CREATE TABLE "WagerCampaign" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL,
    "gameType" "GameType",
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WagerCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WagerLeaderboard" (
    "id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "wageredLamports" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "WagerLeaderboard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WagerCampaign_active_startsAt_endsAt_idx" ON "WagerCampaign"("active", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "WagerLeaderboard_period_wageredLamports_idx" ON "WagerLeaderboard"("period", "wageredLamports");

-- CreateIndex
CREATE UNIQUE INDEX "WagerLeaderboard_period_userId_key" ON "WagerLeaderboard"("period", "userId");

-- AddForeignKey
ALTER TABLE "WagerLeaderboard" ADD CONSTRAINT "WagerLeaderboard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

