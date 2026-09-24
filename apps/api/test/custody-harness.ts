import { randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import type {
  CustodyChain,
  SignatureState,
  SignedTransfer,
  TreasuryTx,
} from '../src/custody/custody-chain';
import { CustodyRuntime } from '../src/custody/custody-runtime';
import { DepositService } from '../src/custody/deposit.service';
import { WithdrawalService } from '../src/custody/withdrawal.service';
import { RgService } from '../src/responsible-gambling/rg.service';
import { prisma } from './engine-harness';

/**
 * Custody against real Postgres with an in-memory ledger standing in for
 * Solana (the real-validator suite is custody-chain.e2e-spec.ts). The fake
 * models exactly what the services rely on: balances, a treasury history, and
 * signatures that land, fail, stay unseen, or expire with their blockhash.
 */

/**
 * What happens to the next broadcast signature: lands; fails at the
 * commitment; seen failing but not yet final (`failing`); never seen (`drop`);
 * seen succeeding but not yet final (`hang`).
 */
export type Fate = 'land' | 'fail' | 'failing' | 'drop' | 'hang';

const sig = () => bs58.encode(randomBytes(64));

export class FakeCustodyChain implements CustodyChain {
  readonly balances = new Map<string, bigint>();
  /** Signature → how getTransaction sees it (deposits and our withdrawals). */
  readonly txs = new Map<string, TreasuryTx & { slot?: bigint }>();
  /** Treasury history, oldest first. */
  readonly history: { signature: string; slot: bigint }[] = [];
  /** Broadcast withdrawals: signature → what happened. */
  readonly sent = new Map<
    string,
    { to: string; lamports: bigint; memo: string; state: SignatureState; lastValid: bigint }
  >();
  /** Signed (maybe never broadcast) withdrawals. */
  readonly signed: string[] = [];
  fate: Fate = 'land';
  finalizedHeight = 1_000n;
  private slot = 1n;
  private readonly pending = new Map<
    string,
    { to: string; lamports: bigint; memo: string; lastValid: bigint; from: string }
  >();

  constructor(readonly treasury: string) {}

  genesisHash(): Promise<string> {
    return Promise.resolve('FakeLocalGenesis111111111111111111111111111');
  }

  balance(address: string): Promise<bigint> {
    return Promise.resolve(this.balances.get(address) ?? 0n);
  }

  /** A player sends `lamports` to the treasury from `from` (fee payer first). Returns the signature. */
  deposit(from: string, lamports: bigint, coSigners: string[] = []): string {
    const s = sig();
    const slot = (this.slot += 1n);
    this.balances.set(this.treasury, (this.balances.get(this.treasury) ?? 0n) + lamports);
    this.txs.set(s, { kind: 'inbound', slot, amount: lamports, signers: [from, ...coSigners] });
    this.history.push({ signature: s, slot });
    return s;
  }

  treasuryTx(signature: string): Promise<TreasuryTx> {
    const t = this.txs.get(signature);
    if (!t) return Promise.resolve({ kind: 'missing' });
    if (t.kind === 'inbound') {
      return Promise.resolve({ kind: 'inbound', slot: t.slot, amount: t.amount, signers: t.signers });
    }
    return Promise.resolve({ kind: t.kind } as TreasuryTx);
  }

  signaturesSince(_address: string, until: string | null) {
    const from = until ? this.history.findIndex((h) => h.signature === until) + 1 : 0;
    return Promise.resolve(this.history.slice(from));
  }

  signTransfer(from: Keypair, to: string, lamports: bigint, memo: string): Promise<SignedTransfer> {
    const s = sig();
    const lastValid = this.finalizedHeight + 150n;
    this.pending.set(s, { to, lamports, memo, lastValid, from: from.publicKey.toBase58() });
    this.signed.push(s);
    return Promise.resolve({ signature: s, raw: Buffer.from(s), lastValidBlockHeight: lastValid });
  }

  broadcast(raw: Buffer): Promise<void> {
    const s = raw.toString();
    const p = this.pending.get(s)!;
    const slot = (this.slot += 1n);
    const landed = this.fate === 'land' || this.fate === 'fail';
    const failed = this.fate === 'fail' || this.fate === 'failing';
    const seen = landed || this.fate === 'hang' || this.fate === 'failing';
    this.sent.set(s, {
      to: p.to,
      lamports: p.lamports,
      memo: p.memo,
      lastValid: p.lastValid,
      state: { found: seen, failed, settled: landed, slot: seen ? slot : null },
    });
    if (landed && !failed) {
      this.balances.set(p.from, (this.balances.get(p.from) ?? 0n) - p.lamports);
      this.balances.set(p.to, (this.balances.get(p.to) ?? 0n) + p.lamports);
    }
    if (landed) {
      this.txs.set(s, { kind: failed ? 'failed' : 'outbound' });
      this.history.push({ signature: s, slot });
    }
    return Promise.resolve();
  }

  signatureState(signature: string): Promise<SignatureState> {
    return Promise.resolve(
      this.sent.get(signature)?.state ?? { found: false, failed: false, settled: false, slot: null },
    );
  }

  finalizedBlockHeight(): Promise<bigint> {
    return Promise.resolve(this.finalizedHeight);
  }

  /** Lamports that actually reached `to` through landed withdrawals. */
  paidTo(to: string): bigint {
    let total = 0n;
    for (const s of this.sent.values()) {
      if (s.to === to && s.state.settled && !s.state.failed) total += s.lamports;
    }
    return total;
  }
}

const CUSTODY_ENV = ['CUSTODY_ENABLED', 'CUSTODY_HOT_WALLET_SECRET_KEY', 'SOLANA_NETWORK', 'SOLANA_RPC_URL'];

/** Custody switched on against a fresh fake ledger; `restore()` puts the env back. */
export async function custodyRig(opts: { hotLamports?: bigint } = {}) {
  const saved = Object.fromEntries(CUSTODY_ENV.map((k) => [k, process.env[k]]));
  const hot = Keypair.generate();
  process.env.CUSTODY_ENABLED = 'true';
  process.env.CUSTODY_HOT_WALLET_SECRET_KEY = bs58.encode(hot.secretKey);
  process.env.SOLANA_NETWORK = 'localnet';
  delete process.env.SOLANA_RPC_URL;

  const treasury = hot.publicKey.toBase58();
  const chain = new FakeCustodyChain(treasury);
  chain.balances.set(treasury, opts.hotLamports ?? 1_000n * 10n ** 9n);
  const runtime = new CustodyRuntime(chain);
  await runtime.prove();
  // The global pause (#56), switchable per test.
  const maintenance = { paused: false, isPaused: async () => maintenance.paused };
  const rg = new RgService(prisma as never, maintenance as never, { realMoneyEnabled: false } as never);
  const deposits = new DepositService(prisma as never, runtime, rg);
  const withdrawals = new WithdrawalService(prisma as never, runtime, maintenance as never);

  // Each rig owns the custody tables: no other suite writes them.
  await prisma.custodyTransfer.deleteMany({});
  await prisma.scanCursor.deleteMany({});

  return {
    chain,
    runtime,
    deposits,
    withdrawals,
    maintenance,
    treasury,
    restore() {
      withdrawals.onModuleDestroy();
      for (const k of CUSTODY_ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    },
  };
}

/** Custody's economy rules on (or off) without a chain — for the game-side specs. */
export function economyOn(): () => void {
  const saved = process.env.CUSTODY_ENABLED;
  process.env.CUSTODY_ENABLED = 'true';
  return () => {
    if (saved === undefined) delete process.env.CUSTODY_ENABLED;
    else process.env.CUSTODY_ENABLED = saved;
  };
}

/** Mark a user as a funded (deposited) account. */
export async function fund(userId: string, balance?: bigint) {
  await prisma.user.update({
    where: { id: userId },
    data: { fundedAt: new Date(), ...(balance !== undefined ? { playBalanceLamports: balance } : {}) },
  });
}
