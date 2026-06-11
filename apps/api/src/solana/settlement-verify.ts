/**
 * Post-confirm settlement verification (#26) — pure, so the success criteria
 * ("the chain really moved the value we claimed") is unit-testable without a
 * validator. The HOUSE vault delta is the rent-noise-free signal: the cosigner
 * pays any init_if_needed rent and the user vault may be freshly created, but
 * the house vault only ever changes by the settlement net.
 */

export interface ConfirmedTxLike {
  meta?: {
    err: unknown;
    preBalances: number[];
    postBalances: number[];
  } | null;
  transaction?: {
    message: {
      getAccountKeys?: () => { staticAccountKeys: { toBase58(): string }[] };
      staticAccountKeys?: { toBase58(): string }[];
      accountKeys?: { toBase58(): string }[];
    };
  };
}

function accountKeysOf(tx: ConfirmedTxLike): { toBase58(): string }[] {
  const msg = tx.transaction?.message;
  if (!msg) return [];
  if (typeof msg.getAccountKeys === 'function') return msg.getAccountKeys().staticAccountKeys;
  return msg.staticAccountKeys ?? msg.accountKeys ?? [];
}

/**
 * True iff the confirmed transaction (a) exists, (b) succeeded
 * (`meta.err == null`), and (c) changed the house vault's lamports by EXACTLY
 * `expectedDelta` (positive = house gained the loss net; negative = house paid
 * the win net; 0n = push).
 */
export function settlementMoved(
  tx: ConfirmedTxLike | null,
  houseVaultBase58: string,
  expectedDelta: bigint,
): boolean {
  if (!tx?.meta || tx.meta.err !== null) return false;
  const keys = accountKeysOf(tx);
  const idx = keys.findIndex((k) => k.toBase58() === houseVaultBase58);
  if (idx < 0) return false;
  const pre = tx.meta.preBalances[idx];
  const post = tx.meta.postBalances[idx];
  if (pre === undefined || post === undefined) return false;
  return BigInt(post) - BigInt(pre) === expectedDelta;
}
