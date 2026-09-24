import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import type { CustodyCommitment } from './custody.config';

/** SPL Memo program — tags each withdrawal with its row id on the explorer. */
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/**
 * What one transaction did to the treasury.
 *  - missing   : not visible at the commitment (yet, or never)
 *  - failed    : landed with an error — no value moved
 *  - outbound  : the treasury signed it (one of our withdrawals)
 *  - inbound   : lamports arrived; `amount` is the treasury's balance change
 *  - unrelated : the treasury balance did not grow
 */
export type TreasuryTx =
  | { kind: 'missing' }
  | { kind: 'failed' }
  | { kind: 'outbound' }
  | { kind: 'unrelated' }
  | { kind: 'inbound'; slot: bigint; amount: bigint; signers: string[] };

export interface SignatureState {
  /** Present in the ledger at `confirmed` or better. */
  found: boolean;
  /** Landed with an error (no value moved). */
  failed: boolean;
  /** Reached the configured commitment. */
  settled: boolean;
  slot: bigint | null;
}

export interface SignedTransfer {
  signature: string;
  raw: Buffer;
  lastValidBlockHeight: bigint;
}

/**
 * Every Solana call custody makes, behind one seam: the web3.js implementation
 * below in production, an in-memory ledger in the DB integration tests. Nothing
 * else in the custody module talks to an RPC.
 */
export interface CustodyChain {
  genesisHash(): Promise<string>;
  balance(address: string): Promise<bigint>;
  /** Classify a transaction by its effect on `treasury` (balance deltas, not instruction parsing). */
  treasuryTx(signature: string, treasury: string): Promise<TreasuryTx>;
  /** Successful signatures touching `address` after `until` (exclusive), oldest first. */
  signaturesSince(
    address: string,
    until: string | null,
    pageSize: number,
  ): Promise<{ signature: string; slot: bigint }[]>;
  signTransfer(from: Keypair, to: string, lamports: bigint, memo: string): Promise<SignedTransfer>;
  /** Send a signed transaction. Errors are advisory: the state machine decides by signature status. */
  broadcast(raw: Buffer): Promise<void>;
  signatureState(signature: string): Promise<SignatureState>;
  finalizedBlockHeight(): Promise<bigint>;
}

export class Web3CustodyChain implements CustodyChain {
  private readonly connection: Connection;

  constructor(
    rpcUrl: string,
    private readonly commitment: CustodyCommitment,
  ) {
    this.connection = new Connection(rpcUrl, commitment);
  }

  genesisHash(): Promise<string> {
    return this.connection.getGenesisHash();
  }

  async balance(address: string): Promise<bigint> {
    return BigInt(await this.connection.getBalance(new PublicKey(address), this.commitment));
  }

  async treasuryTx(signature: string, treasury: string): Promise<TreasuryTx> {
    const tx = await this.connection.getTransaction(signature, {
      commitment: this.commitment,
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || !tx.meta) return { kind: 'missing' };
    if (tx.meta.err) return { kind: 'failed' };
    const message = tx.transaction.message;
    const keys = message
      .getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses })
      .keySegments()
      .flat()
      .map((k) => k.toBase58());
    const signers = keys.slice(0, message.header.numRequiredSignatures);
    if (signers.includes(treasury)) return { kind: 'outbound' };
    const i = keys.indexOf(treasury);
    if (i < 0) return { kind: 'unrelated' };
    const delta = BigInt(tx.meta.postBalances[i] ?? 0) - BigInt(tx.meta.preBalances[i] ?? 0);
    if (delta <= 0n) return { kind: 'unrelated' };
    return { kind: 'inbound', slot: BigInt(tx.slot), amount: delta, signers };
  }

  async signaturesSince(address: string, until: string | null, pageSize: number) {
    const pk = new PublicKey(address);
    const out: { signature: string; slot: bigint }[] = [];
    let before: string | undefined;
    // Newest first, page by page, back to the cursor.
    for (;;) {
      const page = await this.connection.getSignaturesForAddress(
        pk,
        { before, until: until ?? undefined, limit: pageSize },
        this.commitment,
      );
      for (const s of page) {
        if (!s.err) out.push({ signature: s.signature, slot: BigInt(s.slot) });
      }
      if (page.length < pageSize) break;
      before = page[page.length - 1]!.signature;
    }
    return out.reverse();
  }

  async signTransfer(from: Keypair, to: string, lamports: bigint, memo: string) {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: from.publicKey, blockhash, lastValidBlockHeight }).add(
      SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: new PublicKey(to),
        lamports,
      }),
      new TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [],
        data: Buffer.from(memo, 'utf8'),
      }),
    );
    tx.sign(from);
    return {
      signature: bs58.encode(tx.signature!),
      raw: tx.serialize(),
      lastValidBlockHeight: BigInt(lastValidBlockHeight),
    };
  }

  async broadcast(raw: Buffer): Promise<void> {
    await this.connection.sendRawTransaction(raw, { preflightCommitment: 'confirmed' });
  }

  async signatureState(signature: string): Promise<SignatureState> {
    const { value } = await this.connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const s = value[0];
    if (!s) return { found: false, failed: false, settled: false, slot: null };
    const settled =
      this.commitment === 'confirmed'
        ? s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized'
        : s.confirmationStatus === 'finalized';
    return { found: true, failed: s.err !== null, settled, slot: BigInt(s.slot) };
  }

  async finalizedBlockHeight(): Promise<bigint> {
    return BigInt(await this.connection.getBlockHeight('finalized'));
  }
}

/** A secret key as base58 (Phantom export) or a JSON byte array (solana-keygen). */
export function parseSecretKey(raw: string): Keypair {
  const trimmed = raw.trim();
  const bytes = trimmed.startsWith('[')
    ? Uint8Array.from(JSON.parse(trimmed) as number[])
    : bs58.decode(trimmed);
  if (bytes.length !== 64) throw new Error('a Solana secret key is 64 bytes');
  return Keypair.fromSecretKey(bytes);
}
