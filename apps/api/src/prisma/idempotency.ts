import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Opt-in idempotency for money-moving commands. A client may supply an
 * `Idempotency-Key` header; the command then claims a row keyed by
 * (userId, scope, clientKey) at the TOP of its transaction and stores the
 * JSON-safe response at the END. A retry with the same key short-circuits to the
 * stored response instead of re-executing — and, because the claim happens in
 * the SAME transaction as the command's effects, a thrown command rolls the
 * claim back too, so a failed command leaves no key and the client may retry.
 *
 * When no key is supplied behavior is IDENTICAL to today (the feature is purely
 * additive). Responses stored in `responseJson` MUST be JSON-safe — Prisma's
 * Json type cannot hold BigInt, so callers must pass already string-serialized
 * DTOs (the command responses are).
 */

/**
 * Try to claim the key for this (userId, scope) at the start of a command.
 *
 * Returns:
 *  - `null` when there is no key (opt-out) OR the claim succeeded (caller
 *    proceeds to execute the command).
 *  - the stored `responseJson` when a completed prior request is being replayed.
 *
 * Throws `ConflictException` (409) when a prior request with the same key is
 * still in flight (claimed but not yet stored).
 */
export async function claimIdempotency(
  tx: Prisma.TransactionClient,
  userId: string,
  scope: string,
  key?: string,
): Promise<unknown | null> {
  if (!key) return null;

  // Use createMany(skipDuplicates) rather than create+catch(P2002): a failed
  // INSERT aborts the surrounding Postgres transaction (SQLSTATE 25P02), after
  // which the replay `findUnique` below would itself error. skipDuplicates never
  // throws, so the transaction stays usable on the replay path.
  const { count } = await tx.idempotencyKey.createMany({
    data: [{ userId, scope, clientKey: key }],
    skipDuplicates: true,
  });
  if (count === 1) return null; // fresh claim — caller proceeds

  // A prior request already claimed this key.
  const existing = await tx.idempotencyKey.findUnique({
    where: { userId_scope_clientKey: { userId, scope, clientKey: key } },
  });
  if (existing?.responseJson != null) {
    // Completed prior request — replay the stored response.
    return existing.responseJson;
  }
  // Claimed but no stored response yet (committed in-flight peer, or a prior
  // attempt that hasn't completed) → tell the client to retry later.
  throw new ConflictException('Request already in progress');
}

/**
 * Persist the JSON-safe response for a previously-claimed key. No-op when no key
 * was supplied. `response` MUST be JSON-safe (no BigInt — stringify first).
 */
export async function storeIdempotency(
  tx: Prisma.TransactionClient,
  userId: string,
  scope: string,
  key: string | undefined,
  response: unknown,
): Promise<void> {
  if (!key) return;
  await tx.idempotencyKey.update({
    where: { userId_scope_clientKey: { userId, scope, clientKey: key } },
    data: { responseJson: response as Prisma.InputJsonValue },
  });
}
