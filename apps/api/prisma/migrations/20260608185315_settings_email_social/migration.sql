-- AlterTable
ALTER TABLE "User" ADD COLUMN     "discordAccount" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "googleAccount" TEXT,
ADD COLUMN     "notifyEmailWins" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyMarketing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telegramAccount" TEXT;
