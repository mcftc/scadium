import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { withSerializable } from './with-serializable';

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(`err ${code}`, {
    code,
    clientVersion: 'test',
  });
}

describe('withSerializable (unit)', () => {
  it('runs inside a Serializable transaction', async () => {
    const $transaction = vi.fn().mockResolvedValue('ok');
    const prisma = { $transaction } as never;
    const fn = async () => 'ok';

    await withSerializable(prisma, fn);

    expect($transaction).toHaveBeenCalledWith(fn, { isolationLevel: 'Serializable' });
  });

  it('retries the whole closure on P2034 and then resolves', async () => {
    let calls = 0;
    const $transaction = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw knownError('P2034');
      return 'ok';
    });
    const prisma = { $transaction } as never;

    await expect(withSerializable(prisma, async () => 'ok', 5)).resolves.toBe('ok');
    expect($transaction).toHaveBeenCalledTimes(3);
  });

  it('rethrows after exhausting attempts on persistent serialization conflict', async () => {
    const $transaction = vi.fn().mockRejectedValue(knownError('P2034'));
    const prisma = { $transaction } as never;

    await expect(withSerializable(prisma, async () => 'x', 5)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect($transaction).toHaveBeenCalledTimes(5);
  });

  it('retries on a bare Postgres 40001 SQLSTATE too', async () => {
    let calls = 0;
    const $transaction = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) throw { code: '40001', message: 'serialization_failure' };
      return 'done';
    });
    const prisma = { $transaction } as never;

    await expect(withSerializable(prisma, async () => 'done', 5)).resolves.toBe('done');
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a non-retryable error (e.g. P2025 record-not-found)', async () => {
    const err = knownError('P2025');
    const $transaction = vi.fn().mockRejectedValue(err);
    const prisma = { $transaction } as never;

    await expect(withSerializable(prisma, async () => 'x', 5)).rejects.toBe(err);
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
