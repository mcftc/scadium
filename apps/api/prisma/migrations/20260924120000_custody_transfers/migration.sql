-- Custody (ADR 0005): a custodial site balance replaces the never-enabled
-- vault-PDA bridge. VaultTransfer becomes CustodyTransfer (both directions,
-- with a status lifecycle); User.vaultAddress becomes User.fundedAt.

CREATE TYPE "CustodyKind" AS ENUM ('deposit', 'withdraw');
CREATE TYPE "CustodyStatus" AS ENUM ('held', 'credited', 'pending', 'sent', 'confirmed', 'failed');
CREATE TYPE "CustodyHoldReason" AS ENUM ('unattributed', 'ambiguous_sender', 'below_minimum', 'paused', 'deposit_limit', 'age_unverified', 'open_play_positions');

-- User: fundedAt replaces vaultAddress, deliberately WITHOUT carrying it over.
-- The vault bridge was never enabled; were any vaultAddress set, its SOL is
-- still in the owner's own PDA (withdrawable by them on chain), so marking the
-- account funded would make its play balance withdrawable a second time. Such
-- accounts stay play accounts and convert on their first custody deposit.
ALTER TABLE "User" ADD COLUMN "fundedAt" TIMESTAMP(3);
DROP INDEX "User_vaultAddress_key";
ALTER TABLE "User" DROP COLUMN "vaultAddress";

-- VaultTransfer → CustodyTransfer. Existing rows were verified, settled vault
-- transfers: they keep their data and become credited / confirmed.
ALTER TABLE "VaultTransfer" RENAME TO "CustodyTransfer";
ALTER TABLE "CustodyTransfer" RENAME CONSTRAINT "VaultTransfer_pkey" TO "CustodyTransfer_pkey";
ALTER TABLE "CustodyTransfer" DROP CONSTRAINT "VaultTransfer_userId_fkey";
ALTER INDEX "VaultTransfer_txSignature_key" RENAME TO "CustodyTransfer_txSignature_key";
DROP INDEX "VaultTransfer_userId_createdAt_idx";

ALTER TABLE "CustodyTransfer"
  ALTER COLUMN "kind" TYPE "CustodyKind" USING "kind"::"CustodyKind",
  ALTER COLUMN "userId" DROP NOT NULL,
  ALTER COLUMN "txSignature" DROP NOT NULL,
  ADD COLUMN "status" "CustodyStatus",
  ADD COLUMN "wallet" TEXT,
  ADD COLUMN "slot" BIGINT,
  ADD COLUMN "lastValidBlockHeight" BIGINT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "heldReason" "CustodyHoldReason",
  ADD COLUMN "error" TEXT,
  ADD COLUMN "settledAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "CustodyTransfer" t
SET "status" = CASE t."kind" WHEN 'deposit' THEN 'credited'::"CustodyStatus" ELSE 'confirmed'::"CustodyStatus" END,
    "wallet" = u."walletAddress",
    "settledAt" = t."createdAt",
    "updatedAt" = t."createdAt"
FROM "User" u
WHERE u."id" = t."userId";

ALTER TABLE "CustodyTransfer"
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "wallet" SET NOT NULL,
  ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE INDEX "CustodyTransfer_userId_kind_createdAt_idx" ON "CustodyTransfer"("userId", "kind", "createdAt");
CREATE INDEX "CustodyTransfer_kind_status_idx" ON "CustodyTransfer"("kind", "status");

-- Money records are never cascaded away with a user.
ALTER TABLE "CustodyTransfer" ADD CONSTRAINT "CustodyTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ScanCursor" (
    "key" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "slot" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanCursor_pkey" PRIMARY KEY ("key")
);
