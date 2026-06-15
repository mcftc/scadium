-- AlterTable
ALTER TABLE "User" ADD COLUMN     "signupIpHash" TEXT;

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false;
