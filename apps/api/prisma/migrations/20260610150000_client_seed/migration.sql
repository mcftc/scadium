-- Phase I (#18 / #91): per-user rotating provably-fair seed state.
-- One row per user holding the player-controlled client seed, a monotonic
-- BigInt nonce, the active server-seed pair, and the pre-committed next pair.

-- CreateTable
CREATE TABLE "ClientSeed" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" BIGINT NOT NULL DEFAULT 0,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "nextServerSeed" TEXT NOT NULL,
    "nextServerSeedHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "ClientSeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientSeed_userId_key" ON "ClientSeed"("userId");

-- AddForeignKey
ALTER TABLE "ClientSeed" ADD CONSTRAINT "ClientSeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
