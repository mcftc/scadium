-- AlterTable
ALTER TABLE "AirdropPool" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "statsResetAt" TIMESTAMP(3);
