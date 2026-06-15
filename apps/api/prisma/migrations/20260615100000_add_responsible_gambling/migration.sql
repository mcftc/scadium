-- AlterTable
ALTER TABLE "User" ADD COLUMN     "selfExcludedUntil" TIMESTAMP(3),
ADD COLUMN     "coolOffUntil" TIMESTAMP(3),
ADD COLUMN     "dailyDepositLimitLamports" BIGINT,
ADD COLUMN     "dailyLossLimitLamports" BIGINT,
ADD COLUMN     "dailyWagerLimitLamports" BIGINT;
