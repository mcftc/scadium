-- Phase J (#27): verified on-chain vault transfers — idempotent crediting
-- keyed on the transaction signature.

CREATE TABLE "VaultTransfer" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "txSignature" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountLamports" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VaultTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VaultTransfer_txSignature_key" ON "VaultTransfer"("txSignature");
CREATE INDEX "VaultTransfer_userId_createdAt_idx" ON "VaultTransfer"("userId", "createdAt");

ALTER TABLE "VaultTransfer" ADD CONSTRAINT "VaultTransfer_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
