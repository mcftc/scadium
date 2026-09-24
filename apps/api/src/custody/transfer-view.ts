import type { CustodyTransfer } from '@prisma/client';

/** A custody transfer as the API returns it (JSON-safe: lamports as strings). */
export interface TransferView {
  id: string;
  kind: CustodyTransfer['kind'];
  status: CustodyTransfer['status'];
  amountLamports: string;
  wallet: string;
  txSignature: string | null;
  heldReason: CustodyTransfer['heldReason'];
  createdAt: string;
  settledAt: string | null;
}

export function transferView(row: CustodyTransfer): TransferView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    amountLamports: row.amountLamports.toString(),
    wallet: row.wallet,
    txSignature: row.txSignature,
    heldReason: row.heldReason,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}
