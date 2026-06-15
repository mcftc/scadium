import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable mock of the env module so we can flip the network per test (#53).
const { mockEnv } = vi.hoisted(() => ({ mockEnv: { solanaNetwork: 'devnet' } }));
vi.mock('@/config/env', () => ({ env: mockEnv }));

import { solscanTx, solscanAccount, solscanToken } from './explorer';

describe('solscan explorer links (#53)', () => {
  beforeEach(() => {
    mockEnv.solanaNetwork = 'devnet';
  });

  it('appends ?cluster=devnet on devnet', () => {
    expect(solscanTx('SIG')).toBe('https://solscan.io/tx/SIG?cluster=devnet');
    expect(solscanAccount('ADDR')).toBe('https://solscan.io/account/ADDR?cluster=devnet');
    expect(solscanToken('MINT')).toBe('https://solscan.io/token/MINT?cluster=devnet');
  });

  it('omits the cluster param on mainnet-beta (Solscan default)', () => {
    mockEnv.solanaNetwork = 'mainnet-beta';
    expect(solscanTx('SIG')).toBe('https://solscan.io/tx/SIG');
    expect(solscanAccount('ADDR')).toBe('https://solscan.io/account/ADDR');
    expect(solscanToken('MINT')).toBe('https://solscan.io/token/MINT');
  });

  it('appends the cluster param for testnet', () => {
    mockEnv.solanaNetwork = 'testnet';
    expect(solscanTx('SIG')).toBe('https://solscan.io/tx/SIG?cluster=testnet');
  });

  it('omits the cluster param for localnet (no Solscan cluster) — link opens on mainnet', () => {
    mockEnv.solanaNetwork = 'localnet';
    expect(solscanTx('SIG')).toBe('https://solscan.io/tx/SIG');
  });
});
