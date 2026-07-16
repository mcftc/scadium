-- CreateTable
CREATE TABLE "RaceResult" (
    "id" UUID NOT NULL,
    "raceDay" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "volumeLamports" BIGINT NOT NULL,
    "prizeLamports" BIGINT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaceResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RaceResult_raceDay_userId_key" ON "RaceResult"("raceDay", "userId");

-- CreateIndex
CREATE INDEX "RaceResult_raceDay_rank_idx" ON "RaceResult"("raceDay", "rank");
