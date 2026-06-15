-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('none', 'pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kycStatus" "KycStatus" NOT NULL DEFAULT 'none',
ADD COLUMN     "kycProviderRef" TEXT,
ADD COLUMN     "sanctionsCleared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kycReviewedAt" TIMESTAMP(3);
