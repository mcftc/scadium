-- CreateTable
CREATE TABLE "VaultAccrualRound" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "ngrLamports" BIGINT NOT NULL DEFAULT 0,
    "yieldScad" BIGINT NOT NULL DEFAULT 0,
    "poolCount" INTEGER NOT NULL DEFAULT 0,
    "distributed" BOOLEAN NOT NULL DEFAULT false,
    "distributedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultAccrualRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VaultAccrualRound_period_key" ON "VaultAccrualRound"("period");
