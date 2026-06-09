-- AlterTable
ALTER TABLE "LotteryDraw" DROP COLUMN "bonusNumber",
DROP COLUMN "mainNumbers",
ADD COLUMN     "bracketAmountsScadBase" BIGINT[],
ADD COLUMN     "bracketRolloverScadBase" BIGINT[],
ADD COLUMN     "bracketWinnerCounts" INTEGER[],
ADD COLUMN     "burnScadBase" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "injectionScadBase" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "rolloverScadBase" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "ticketPriceScadBase" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "totalPoolScadBase" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "winningDigits" INTEGER[];

-- AlterTable
ALTER TABLE "LotteryTicket" DROP COLUMN "bonusNumber",
DROP COLUMN "mainNumbers",
DROP COLUMN "matchedBonus",
DROP COLUMN "matchedMain",
DROP COLUMN "payoutUsdtBase",
DROP COLUMN "tier",
ADD COLUMN     "bracket" INTEGER,
ADD COLUMN     "costScadBase" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "digits" INTEGER[],
ADD COLUMN     "matchLen" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payoutScadBase" BIGINT NOT NULL DEFAULT 0;
