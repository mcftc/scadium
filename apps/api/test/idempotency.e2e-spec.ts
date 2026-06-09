import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { CRASH, JACKPOT } from '@scadium/shared';
import { bootstrapApp, seedUser, getPrisma, type BootstrapResult } from './setup';

/**
 * Idempotency keys + jackpot uniqueness over the real HTTP stack (#6).
 */
describe('idempotency + jackpot uniqueness (integration, real Postgres)', () => {
  let harness: BootstrapResult;
  const prisma = getPrisma();

  beforeAll(async () => {
    harness = await bootstrapApp();
  });
  afterAll(async () => {
    await harness.app.close();
    await prisma.$disconnect();
  });

  it('crash bet with a repeated Idempotency-Key debits ONCE and returns the same response', async () => {
    const bet = BigInt(CRASH.MIN_BET_LAMPORTS);
    const { user, token } = await seedUser(bet * 5n, harness.signToken, prisma);
    const key = `crashkey-${user.id}`;

    const send = () =>
      request(harness.server)
        .post('/api/v1/crash/bet')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send({ amountLamports: bet.toString() });

    const first = await send();
    const second = await send();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body); // replay returns the original response

    // Debited exactly once.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(bet * 5n - bet);
    // Exactly one persisted idempotency record for this key.
    const keys = await prisma.idempotencyKey.findMany({
      where: { userId: user.id, scope: 'crash_bet', clientKey: key },
    });
    expect(keys.length).toBe(1);
  });

  it('jackpot enter twice WITHOUT a key: second is rejected 400, only one entry exists', async () => {
    const amount = BigInt(JACKPOT.MIN_ENTRY_LAMPORTS);
    const { user, token } = await seedUser(amount * 5n, harness.signToken, prisma);

    const enter = () =>
      request(harness.server)
        .post('/api/v1/jackpot/enter')
        .set('Authorization', `Bearer ${token}`)
        .send({ amountLamports: amount.toString() });

    const first = await enter();
    const second = await enter();

    expect(first.status).toBe(201);
    expect(second.status).toBe(400); // (roundId,userId) unique → clear 400, not 500
    expect(String(second.body.message)).toMatch(/already entered/i);

    const entries = await prisma.jackpotEntry.count({ where: { userId: user.id } });
    expect(entries).toBe(1);
  });

  it('jackpot enter twice WITH the same key: replay returns the original, one entry, debited once', async () => {
    const amount = BigInt(JACKPOT.MIN_ENTRY_LAMPORTS);
    const { user, token } = await seedUser(amount * 5n, harness.signToken, prisma);
    const key = `jackkey-${user.id}`;

    const enter = () =>
      request(harness.server)
        .post('/api/v1/jackpot/enter')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send({ amountLamports: amount.toString() });

    const first = await enter();
    const second = await enter();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201); // replay (NOT the 400 path), same body
    expect(second.body).toEqual(first.body);

    expect(await prisma.jackpotEntry.count({ where: { userId: user.id } })).toBe(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(amount * 5n - amount); // debited once
  });
});
