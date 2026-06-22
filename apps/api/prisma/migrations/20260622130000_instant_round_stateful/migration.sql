-- CreateEnum
CREATE TYPE "InstantRoundStatus" AS ENUM ('active', 'won', 'lost');

-- CreateTable
CREATE TABLE "InstantRound" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gameType" "GameType" NOT NULL,
    "stakeLamports" BIGINT NOT NULL,
    "status" "InstantRoundStatus" NOT NULL DEFAULT 'active',
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stateJson" JSONB NOT NULL,
    "betId" UUID,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstantRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstantRound_userId_createdAt_idx" ON "InstantRound"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "InstantRound_userId_gameType_status_idx" ON "InstantRound"("userId", "gameType", "status");

-- Money-safety: at most ONE active round per (user, game). Partial unique index
-- (Prisma can't express this in the schema) — a concurrent double-start hits a
-- P2002 the start helper turns into a clean 409.
CREATE UNIQUE INDEX "InstantRound_one_active_per_user_game"
    ON "InstantRound"("userId", "gameType")
    WHERE "status" = 'active';

-- AddForeignKey
ALTER TABLE "InstantRound" ADD CONSTRAINT "InstantRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
