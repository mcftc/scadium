import { afterEach, describe, expect, it, vi } from 'vitest';
import { Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { clusterForGenesisHash } from '@scadium/shared';
import { custodyConfig } from './custody.config';
import { parseSecretKey, Web3CustodyChain } from './custody-chain';
import { CustodyRuntime } from './custody-runtime';
import type { CustodyChain } from './custody-chain';

const DEVNET = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const ENV_KEYS = [
  'CUSTODY_ENABLED',
  'CUSTODY_HOT_WALLET_SECRET_KEY',
  'CUSTODY_COMMITMENT',
  'CUSTODY_MIN_DEPOSIT_LAMPORTS',
  'CUSTODY_WITHDRAW_MAX_ATTEMPTS',
  'CUSTODY_SCAN_PAGE',
  'SOLANA_NETWORK',
  'SOLANA_RPC_URL',
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('custodyConfig', () => {
  it('defaults: off, finalized, 0.01 SOL minimums, 10 SOL max, 25 SOL daily', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const c = custodyConfig();
    const sol = BigInt(LAMPORTS_PER_SOL);
    expect(c.enabled).toBe(false);
    expect(c.hotWalletSecret).toBeNull();
    expect(c.commitment).toBe('finalized');
    expect(c.minDepositLamports).toBe(sol / 100n);
    expect(c.minWithdrawLamports).toBe(sol / 100n);
    expect(c.maxWithdrawLamports).toBe(10n * sol);
    expect(c.dailyWithdrawLamports).toBe(25n * sol);
    expect(c.feeReserveLamports).toBe(sol / 100n);
    expect(c.withdrawMaxAttempts).toBe(5);
    expect(c.scanPage).toBe(1000);
  });

  it('reads overrides live and ignores invalid values', () => {
    process.env.CUSTODY_ENABLED = 'true';
    process.env.CUSTODY_COMMITMENT = 'confirmed';
    process.env.CUSTODY_MIN_DEPOSIT_LAMPORTS = '42';
    process.env.CUSTODY_WITHDRAW_MAX_ATTEMPTS = '-3';
    process.env.CUSTODY_SCAN_PAGE = '5000';
    const c = custodyConfig();
    expect(c.enabled).toBe(true);
    expect(c.commitment).toBe('confirmed');
    expect(c.minDepositLamports).toBe(42n);
    expect(c.withdrawMaxAttempts).toBe(5); // invalid → default
    expect(c.scanPage).toBe(1000); // capped at the RPC maximum

    process.env.CUSTODY_ENABLED = 'yes'; // only the literal "true" enables
    process.env.CUSTODY_COMMITMENT = 'processed'; // never weaker than confirmed
    process.env.CUSTODY_MIN_DEPOSIT_LAMPORTS = '1.5';
    expect(custodyConfig().enabled).toBe(false);
    expect(custodyConfig().commitment).toBe('finalized');
    expect(custodyConfig().minDepositLamports).toBe(BigInt(LAMPORTS_PER_SOL) / 100n);
  });
});

describe('parseSecretKey', () => {
  const kp = Keypair.generate();
  it('accepts base58 and a JSON byte array', () => {
    expect(parseSecretKey(bs58.encode(kp.secretKey)).publicKey.equals(kp.publicKey)).toBe(true);
    expect(
      parseSecretKey(JSON.stringify([...kp.secretKey])).publicKey.equals(kp.publicKey),
    ).toBe(true);
  });
  it('rejects anything that is not 64 bytes', () => {
    expect(() => parseSecretKey(bs58.encode(kp.publicKey.toBytes()))).toThrow(/64 bytes/);
    expect(() => parseSecretKey('[1,2,3]')).toThrow(/64 bytes/);
  });
});

describe('clusterForGenesisHash', () => {
  it('maps the public clusters and treats any other hash as a local validator', () => {
    expect(clusterForGenesisHash(MAINNET)).toBe('mainnet-beta');
    expect(clusterForGenesisHash(DEVNET)).toBe('devnet');
    expect(clusterForGenesisHash('4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY')).toBe('testnet');
    expect(clusterForGenesisHash('SomethingElse111111111111111111111111111111')).toBe('localnet');
  });
});

describe('Web3CustodyChain.treasuryTx (balance deltas, not instruction parsing)', () => {
  const treasury = Keypair.generate().publicKey;
  const sender = Keypair.generate();

  /** A fetched transaction as getTransaction returns it, around a real compiled message. */
  function fetched(opts: {
    from: Keypair;
    to: string;
    delta: number;
    err?: unknown;
  }) {
    const tx = new Transaction({
      feePayer: opts.from.publicKey,
      recentBlockhash: bs58.encode(Buffer.alloc(32, 1)),
    }).add(
      SystemProgram.transfer({
        fromPubkey: opts.from.publicKey,
        toPubkey: new PublicKey(opts.to),
        lamports: Math.abs(opts.delta),
      }),
    );
    const message = tx.compileMessage();
    const keys = message.accountKeys.map((k) => k.toBase58());
    const pre = keys.map(() => 10 * LAMPORTS_PER_SOL);
    const post = [...pre];
    const i = keys.indexOf(treasury.toBase58());
    if (i >= 0) post[i] = pre[i]! + opts.delta;
    return {
      slot: 77,
      meta: { err: opts.err ?? null, preBalances: pre, postBalances: post, loadedAddresses: undefined },
      transaction: { message },
    };
  }

  function chainReturning(response: unknown) {
    const chain = new Web3CustodyChain('http://127.0.0.1:1', 'finalized');
    (chain as unknown as { connection: { getTransaction: unknown } }).connection = {
      getTransaction: vi.fn().mockResolvedValue(response),
    };
    return chain;
  }

  it('inbound: the treasury balance grew — amount = the delta, signers listed', async () => {
    const chain = chainReturning(fetched({ from: sender, to: treasury.toBase58(), delta: 5_000 }));
    expect(await chain.treasuryTx('sig', treasury.toBase58())).toEqual({
      kind: 'inbound',
      slot: 77n,
      amount: 5_000n,
      signers: [sender.publicKey.toBase58()],
    });
  });

  it('missing, failed, outbound (treasury signed) and unrelated are told apart', async () => {
    expect(await chainReturning(null).treasuryTx('s', treasury.toBase58())).toEqual({
      kind: 'missing',
    });
    const failed = fetched({ from: sender, to: treasury.toBase58(), delta: 5, err: { x: 1 } });
    expect(await chainReturning(failed).treasuryTx('s', treasury.toBase58())).toEqual({
      kind: 'failed',
    });
    const other = Keypair.generate().publicKey.toBase58();
    const unrelated = fetched({ from: sender, to: other, delta: 5 });
    expect(await chainReturning(unrelated).treasuryTx('s', treasury.toBase58())).toEqual({
      kind: 'unrelated',
    });
    const hot = Keypair.generate();
    const outbound = fetched({ from: hot, to: other, delta: -5 });
    expect(await chainReturning(outbound).treasuryTx('s', hot.publicKey.toBase58())).toEqual({
      kind: 'outbound',
    });
  });
});

describe('CustodyRuntime — enabled is a setting, active is a proof', () => {
  const key = bs58.encode(Keypair.generate().secretKey);
  const chainWith = (genesis: string | Error): CustodyChain =>
    ({
      genesisHash: genesis instanceof Error ? vi.fn().mockRejectedValue(genesis) : vi.fn().mockResolvedValue(genesis),
    }) as unknown as CustodyChain;

  const setup = (env: Record<string, string>) => {
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, env);
  };

  it('stays inactive when disabled or keyless, and says why', async () => {
    setup({});
    const off = new CustodyRuntime(chainWith(DEVNET));
    expect(await off.prove()).toBeNull();
    expect(off.inactiveReason).toMatch(/disabled/);
    expect(() => off.requireActive()).toThrow(/offline/);

    setup({ CUSTODY_ENABLED: 'true', SOLANA_NETWORK: 'devnet' });
    const keyless = new CustodyRuntime(chainWith(DEVNET));
    expect(await keyless.prove()).toBeNull();
    expect(keyless.inactiveReason).toMatch(/hot wallet key/);

    setup({ CUSTODY_ENABLED: 'true', SOLANA_NETWORK: 'devnet', CUSTODY_HOT_WALLET_SECRET_KEY: 'nope' });
    expect(await new CustodyRuntime(chainWith(DEVNET)).prove()).toBeNull();
  });

  it('activates only when the genesis hash proves the configured cluster', async () => {
    setup({ CUSTODY_ENABLED: 'true', SOLANA_NETWORK: 'devnet', CUSTODY_HOT_WALLET_SECRET_KEY: key });
    const ok = new CustodyRuntime(chainWith(DEVNET));
    const active = await ok.prove();
    expect(active?.cluster).toBe('devnet');
    expect(active?.treasury).toBe(parseSecretKey(key).publicKey.toBase58());

    const wrong = new CustodyRuntime(chainWith('SomeLocalValidatorHash1111111111111111111111'));
    expect(await wrong.prove()).toBeNull();
    expect(wrong.inactiveReason).toMatch(/serves localnet but SOLANA_NETWORK is devnet/);
  });

  it('never activates on mainnet, even when configured for it', async () => {
    setup({
      CUSTODY_ENABLED: 'true',
      SOLANA_NETWORK: 'mainnet-beta',
      SOLANA_RPC_URL: 'https://example.invalid',
      CUSTODY_HOT_WALLET_SECRET_KEY: key,
    });
    const rt = new CustodyRuntime(chainWith(MAINNET));
    expect(await rt.prove()).toBeNull();
    expect(rt.inactiveReason).toMatch(/managed signer/);
  });

  it('retries the proof when the RPC is unreachable', async () => {
    vi.useFakeTimers();
    try {
      setup({ CUSTODY_ENABLED: 'true', SOLANA_NETWORK: 'devnet', CUSTODY_HOT_WALLET_SECRET_KEY: key });
      const genesisHash = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(DEVNET);
      const rt = new CustodyRuntime({ genesisHash } as unknown as CustodyChain);
      expect(await rt.prove()).toBeNull();
      expect(rt.inactiveReason).toMatch(/unreachable/);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(rt.active?.cluster).toBe('devnet');
      rt.onModuleDestroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
