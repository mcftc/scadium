-- CreateTable
CREATE TABLE "TokenBurn" (
    "id" UUID NOT NULL,
    "scadBurned" BIGINT NOT NULL,
    "solSpent" BIGINT NOT NULL,
    "swapSignature" TEXT,
    "burnSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenBurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TokenBurn_createdAt_idx" ON "TokenBurn"("createdAt");

