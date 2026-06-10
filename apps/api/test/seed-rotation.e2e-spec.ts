import { describe, it, expect } from 'vitest';
import { commitServerSeed } from '@scadium/fair';
import { SeedManagerService } from '../src/fairness/seed-manager.service';
import { prisma, makeUser } from './engine-harness';

/**
 * Issue #91 — the per-user seed manager: pairs are valid + the serverSeed stays
 * secret, rotation reveals a seed matching its published commitment, and the
 * nonce increments atomically (no duplicates under concurrency).
 */
describe('SeedManagerService (issue #91)', () => {
  const svc = new SeedManagerService(prisma as never);

  it('creates a valid pair and never leaks the unrevealed serverSeed', async () => {
    const u = await makeUser(0n);
    const view = await svc.getOrCreateActivePair(u.id);
    expect(view.nonce).toBe('0');
    expect(view).not.toHaveProperty('serverSeed');
    // The hashes genuinely commit to the stored secret seeds.
    const row = await prisma.clientSeed.findUniqueOrThrow({ where: { userId: u.id } });
    expect(commitServerSeed(row.serverSeed)).toBe(view.serverSeedHash);
    expect(commitServerSeed(row.nextServerSeed)).toBe(view.nextServerSeedHash);
  });

  it('rotation reveals a seed matching the prior commitment and promotes next', async () => {
    const u = await makeUser(0n);
    const before = await svc.getOrCreateActivePair(u.id);
    const res = await svc.rotateServerSeed(u.id);
    // Revealed seed matches the previously-published active hash.
    expect(commitServerSeed(res.revealedServerSeed)).toBe(before.serverSeedHash);
    // The pre-committed next seed is now the active one.
    expect(res.serverSeedHash).toBe(before.nextServerSeedHash);
    // A fresh next commitment was published.
    expect(res.nextServerSeedHash).not.toBe(before.nextServerSeedHash);
  });

  it('setClientSeed validates length and resets the nonce', async () => {
    const u = await makeUser(0n);
    await svc.nextNonce(u.id); // bump to 1
    const v = await svc.setClientSeed(u.id, 'my-lucky-seed');
    expect(v.clientSeed).toBe('my-lucky-seed');
    expect(v.nonce).toBe('0');
    await expect(svc.setClientSeed(u.id, '')).rejects.toThrow();
    await expect(svc.setClientSeed(u.id, 'x'.repeat(65))).rejects.toThrow();
  });

  it('nextNonce increments atomically — concurrent calls never duplicate', async () => {
    const u = await makeUser(0n);
    const results = await Promise.all(Array.from({ length: 20 }, () => svc.nextNonce(u.id)));
    const nums = results.map((n) => Number(n));
    expect(new Set(nums).size).toBe(20); // all distinct
    expect([...nums].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    ); // exactly 1..20
  });
});
