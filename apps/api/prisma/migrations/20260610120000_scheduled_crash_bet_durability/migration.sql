-- CreateTable
CREATE TABLE "ScheduledCrashBet" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountLamports" BIGINT NOT NULL,
    "autoCashoutMultiplier" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledCrashBet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledCrashBet_userId_key" ON "ScheduledCrashBet"("userId");

-- AddForeignKey
ALTER TABLE "ScheduledCrashBet" ADD CONSTRAINT "ScheduledCrashBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
