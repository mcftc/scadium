-- CreateTable
CREATE TABLE "EngineBlock" (
    "id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "rewardScad" BIGINT NOT NULL DEFAULT 0,
    "totalPlayRate" BIGINT NOT NULL DEFAULT 0,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "winnerId" UUID,
    "bigRewardScad" BIGINT NOT NULL DEFAULT 0,
    "drawSeedHash" TEXT,
    "drawSeed" TEXT,
    "distributed" BOOLEAN NOT NULL DEFAULT false,
    "distributedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineBlockShare" (
    "id" UUID NOT NULL,
    "blockId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "playRate" BIGINT NOT NULL,
    "shareScad" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineBlockShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EngineBlock_period_key" ON "EngineBlock"("period");

-- CreateIndex
CREATE INDEX "EngineBlock_createdAt_idx" ON "EngineBlock"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngineBlockShare_blockId_userId_key" ON "EngineBlockShare"("blockId", "userId");

-- CreateIndex
CREATE INDEX "EngineBlockShare_userId_createdAt_idx" ON "EngineBlockShare"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "EngineBlockShare" ADD CONSTRAINT "EngineBlockShare_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "EngineBlock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineBlockShare" ADD CONSTRAINT "EngineBlockShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
