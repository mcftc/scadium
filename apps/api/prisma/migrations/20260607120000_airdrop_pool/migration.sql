-- Accumulating hourly airdrop pool (solpump left-rail widget).
CREATE TABLE "AirdropPool" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "period" TEXT NOT NULL,
    "baseLamports" BIGINT NOT NULL DEFAULT 0,
    "tipLamports" BIGINT NOT NULL DEFAULT 0,
    "tipsCount" INTEGER NOT NULL DEFAULT 0,
    "distributed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AirdropPool_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AirdropPool_period_key" ON "AirdropPool"("period");
