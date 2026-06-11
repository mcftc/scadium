import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { getPrisma } from './setup';
import { VaultBridgeService } from '../src/solana/vault-bridge.service';
import type { ChainService } from '../src/solana/chain.service';
import type { VaultEvent } from '../src/solana/vault-events';

/**
 * #27 — the custody bridge over real Postgres, with the chain verification
 * stubbed at the ChainService seam (the on-chain deposit/withdraw movement
 * itself is proven by tests/scadium_vault.ts on a local validator; the event
 * decoding by vault-events.spec.ts). Covers: verified credit, signature-replay
 * idempotency, first-deposit conversion (seed forfeited), withdraw debit with
 * drift clamp, and the disabled-chain guard.
 */
describe('vault↔balance bridge (integration, real Postgres)', () => {
  const prisma = getPrisma();
  const RUN = Date.now().toString(36);
  let seq = 0;

  const makeUser = (balance = 10_000_000_000n) => {
    seq += 1;
    return prisma.user.create({
      data: {
        walletAddress: `vb-${RUN}-${seq}`,
        refCode: `vb-ref-${RUN}-${seq}`,
        playBalanceLamports: balance,
      },
    });
  };

  /** Bridge whose chain verifies every signature as `event` (or null). */
  const bridgeWith = (event: VaultEvent | null, enabled = true) =>
    new VaultBridgeService(prisma as never, {
      enabled,
      verifyVaultTransfer: async () => event,
      userVaultPdaBase58: (w: string) => `pda-${w}`,
    } as unknown as ChainService);

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('first verified deposit converts to custody-backed: seed forfeited, balance = deposit', async () => {
    const u = await makeUser(10_000_000_000n); // the 10 SOL play seed
    const bridge = bridgeWith({ user: u.walletAddress, amount: 500_000_000n, vaultBalance: 0n });

    const res = await bridge.confirmDeposit(u.id, u.walletAddress, `sig-${RUN}-a${seq}`);
    expect(res.funded).toBe(true);
    expect(res.spendableLamports).toBe('500000000'); // NOT 10.5 SOL — the seed is gone

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.vaultAddress).toBe(`pda-${u.walletAddress}`);
  });

  it('replaying the same deposit signature credits nothing extra (idempotent)', async () => {
    const u = await makeUser(0n);
    // Unique per user — a fixed literal collides with rows left by other suites.
    await prisma.user.update({ where: { id: u.id }, data: { vaultAddress: `pda-x-${u.id}` } });
    const bridge = bridgeWith({ user: u.walletAddress, amount: 250_000_000n, vaultBalance: 0n });
    const sig = `sig-${RUN}-replay${seq}`;

    await bridge.confirmDeposit(u.id, u.walletAddress, sig);
    const second = await bridge.confirmDeposit(u.id, u.walletAddress, sig);
    expect(second.spendableLamports).toBe('250000000'); // once, not twice

    expect(
      await prisma.vaultTransfer.count({ where: { txSignature: sig } }),
    ).toBe(1);
  });

  it('rejects when chain verification finds no event for this wallet', async () => {
    const u = await makeUser(0n);
    const bridge = bridgeWith(null);
    await expect(
      bridge.confirmDeposit(u.id, u.walletAddress, `sig-${RUN}-bad${seq}`),
    ).rejects.toThrow(BadRequestException);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.playBalanceLamports).toBe(0n); // nothing credited
  });

  it('verified withdraw debits the mirror; a shortfall clamps and flags drift', async () => {
    const u = await makeUser(300_000_000n);
    await prisma.user.update({ where: { id: u.id }, data: { vaultAddress: `pda-y-${u.id}` } });

    // Normal: withdraw 200M of 300M.
    const bridge = bridgeWith({ user: u.walletAddress, amount: 200_000_000n, vaultBalance: 0n });
    const res = await bridge.confirmWithdraw(u.id, u.walletAddress, `sig-${RUN}-w1${seq}`);
    expect(res.spendableLamports).toBe('100000000');

    // Shortfall: user-signed on-chain withdraw of 5 SOL while the mirror holds 0.1 —
    // the debit clamps to the mirror (never negative) and drift is logged.
    const big = bridgeWith({ user: u.walletAddress, amount: 5_000_000_000n, vaultBalance: 0n });
    const res2 = await big.confirmWithdraw(u.id, u.walletAddress, `sig-${RUN}-w2${seq}`);
    expect(res2.spendableLamports).toBe('0');
  });

  it('rejects everything when the chain is disabled (play-money mode untouched)', async () => {
    const u = await makeUser();
    const bridge = bridgeWith({ user: u.walletAddress, amount: 1n, vaultBalance: 0n }, false);
    await expect(
      bridge.confirmDeposit(u.id, u.walletAddress, `sig-${RUN}-off${seq}`),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
