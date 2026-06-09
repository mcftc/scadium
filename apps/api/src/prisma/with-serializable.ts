import { Prisma, type PrismaClient } from '@prisma/client';
import type { PrismaService } from './prisma.service';

/**
 * Postgres SQLSTATE codes that mean "the transaction lost a race and can be
 * safely retried verbatim":
 *  - 40001 serialization_failure (a Serializable conflict — our main case)
 *  - 40P01 deadlock_detected
 * Prisma surfaces the first as the known error code P2034.
 */
const RETRYABLE_PG_CODES = ['40001', '40P01'];

/**
 * True when `e` is a retryable serialization/deadlock conflict. Detection is
 * deliberately defensive: Prisma maps serialization failures to P2034, but a
 * raw `$queryRaw`/`$executeRaw` or an unwrapped driver error can instead carry
 * the bare Postgres SQLSTATE on `.code`, inside `.meta`, or only in the message.
 */
function isRetryable(e: unknown): boolean {
  // Prisma's typed serialization-conflict error.
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
    return true;
  }
  if (typeof e === 'object' && e !== null) {
    const anyErr = e as { code?: unknown; meta?: { code?: unknown } };
    if (typeof anyErr.code === 'string' && RETRYABLE_PG_CODES.includes(anyErr.code)) {
      return true;
    }
    if (anyErr.meta && typeof anyErr.meta.code === 'string') {
      if (RETRYABLE_PG_CODES.includes(anyErr.meta.code)) return true;
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  return RETRYABLE_PG_CODES.some((code) => msg.includes(code));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run `fn` inside a single Serializable transaction, retrying the WHOLE closure
 * on serialization/deadlock conflicts (P2034 / SQLSTATE 40001 / 40P01) up to
 * `attempts` times with a small incremental backoff. Re-throws the last error
 * if every attempt fails (or immediately on any non-retryable error).
 *
 * Serializable is the strongest isolation level: it guarantees the settlement's
 * reads + writes behave as if no other transaction ran concurrently, which is
 * exactly what money-moving game settlements need. The cost is that concurrent
 * conflicting transactions abort with 40001 — hence the retry loop.
 */
export async function withSerializable<T>(
  prisma: PrismaService | PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (e) {
      lastError = e;
      if (!isRetryable(e) || attempt === attempts) throw e;
      // Incremental backoff: ~5ms, 10ms, 15ms, … scaled by attempt number.
      await sleep(5 * attempt);
    }
  }
  // Unreachable (the loop either returns or throws), but satisfies the compiler.
  throw lastError;
}
