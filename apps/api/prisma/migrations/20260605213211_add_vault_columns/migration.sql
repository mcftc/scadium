-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastDailyCaseAt" TIMESTAMP(3),
ADD COLUMN     "vaultAddress" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_vaultAddress_key" ON "User"("vaultAddress");

