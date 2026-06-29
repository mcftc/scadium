import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateServerSeed, generateClientSeed, commitServerSeed } from '@scadium/fair';
import { PrismaService } from '../prisma/prisma.service';

/** Public view of a user's active seed pair — the unrevealed serverSeed is NEVER included. */
export interface ActivePairView {
  serverSeedHash: string;
  nextServerSeedHash: string;
  clientSeed: string;
  nonce: string; // BigInt serialized
}

interface ClientSeedRow {
  clientSeed: string;
  nonce: bigint;
  serverSeed: string;
  serverSeedHash: string;
  nextServerSeed: string;
  nextServerSeedHash: string;
}

/**
 * Per-user provably-fair seed manager (Phase I #18). Owns each user's rotating
 * seed pair: the player-controlled client seed, a monotonic nonce, the ACTIVE
 * server seed (secret until rotated) and a PRE-COMMITTED next server seed. This
 * removes the operator's ability to grind outcomes — the server commits to the
 * next seed before any bet and only reveals the active one on rotation.
 */
@Injectable()
export class SeedManagerService {
  constructor(private readonly prisma: PrismaService) {}

  private mintPair() {
    const serverSeed = generateServerSeed();
    const nextServerSeed = generateServerSeed();
    return {
      serverSeed,
      serverSeedHash: commitServerSeed(serverSeed),
      nextServerSeed,
      nextServerSeedHash: commitServerSeed(nextServerSeed),
    };
  }

  private view(row: ClientSeedRow): ActivePairView {
    return {
      serverSeedHash: row.serverSeedHash,
      nextServerSeedHash: row.nextServerSeedHash,
      clientSeed: row.clientSeed,
      nonce: row.nonce.toString(),
    };
  }

  /** Return the user's seed pair, creating one on first use. Never leaks serverSeed. */
  async getOrCreateActivePair(userId: string): Promise<ActivePairView> {
    const existing = await this.prisma.clientSeed.findUnique({ where: { userId } });
    if (existing) return this.view(existing);
    try {
      const created = await this.prisma.clientSeed.create({
        data: { userId, clientSeed: generateClientSeed(), nonce: BigInt(0), ...this.mintPair() },
      });
      return this.view(created);
    } catch (e) {
      // Concurrent first-use (e.g. parallel bets) races to create the same row;
      // Prisma upsert isn't atomic against that, so catch the unique violation
      // (P2002) and read back the winner's row.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const row = await this.prisma.clientSeed.findUniqueOrThrow({ where: { userId } });
        return this.view(row);
      }
      throw e;
    }
  }

  /** Set the player's client seed (1–64 chars). Resets the nonce per convention. */
  async setClientSeed(userId: string, clientSeed: string): Promise<ActivePairView> {
    const trimmed = clientSeed.trim();
    if (trimmed.length < 1 || trimmed.length > 64) {
      throw new BadRequestException('clientSeed must be 1–64 characters');
    }
    await this.getOrCreateActivePair(userId);
    const updated = await this.prisma.clientSeed.update({
      where: { userId },
      data: { clientSeed: trimmed, nonce: BigInt(0) },
    });
    return this.view(updated);
  }

  /**
   * Reveal the active server seed, promote the pre-committed next seed to active,
   * mint a fresh next commitment, and reset the nonce. Returns the revealed seed
   * (so the player can verify `sha256(revealed) === the previously-published hash`)
   * plus the new commitments.
   */
  async rotateServerSeed(
    userId: string,
  ): Promise<{ revealedServerSeed: string; serverSeedHash: string; nextServerSeedHash: string }> {
    await this.getOrCreateActivePair(userId);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.clientSeed.findUniqueOrThrow({ where: { userId } });
      const freshNext = generateServerSeed();
      const updated = await tx.clientSeed.update({
        where: { userId },
        data: {
          serverSeed: row.nextServerSeed,
          serverSeedHash: row.nextServerSeedHash,
          nextServerSeed: freshNext,
          nextServerSeedHash: commitServerSeed(freshNext),
          nonce: BigInt(0),
          rotatedAt: new Date(),
        },
      });
      return {
        revealedServerSeed: row.serverSeed,
        serverSeedHash: updated.serverSeedHash,
        nextServerSeedHash: updated.nextServerSeedHash,
      };
    });
  }

  /**
   * Atomically increment and return the per-user nonce. The DB-level
   * `{ increment: 1 }` serializes concurrent callers, so no two bets by the same
   * user ever share a nonce.
   */
  async nextNonce(userId: string): Promise<bigint> {
    await this.getOrCreateActivePair(userId);
    const updated = await this.prisma.clientSeed.update({
      where: { userId },
      data: { nonce: { increment: 1 } },
      select: { nonce: true },
    });
    return updated.nonce;
  }

  /**
   * Atomically reserve the next nonce OUTSIDE any caller transaction and return
   * the full derivation context (serverSeed included — SERVER-SIDE ONLY). This is
   * the on-chain-anchored counterpart to {@link consumeNonce}: the shared RNG
   * round (open → reveal, ~1s) must run BEFORE settlement and must NOT be held
   * inside the serializable settlement tx, so the nonce is reserved here first,
   * the entropy is fetched, and the settlement then settles against this exact
   * reserved context (no second increment). The atomic `{ increment: 1 }` keeps
   * concurrent bets from ever sharing a nonce, same as `consumeNonce`.
   */
  async reserveSeedContext(
    userId: string,
  ): Promise<{ serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: bigint }> {
    await this.getOrCreateActivePair(userId);
    return this.prisma.clientSeed.update({
      where: { userId },
      data: { nonce: { increment: 1 } },
      select: { serverSeed: true, serverSeedHash: true, clientSeed: true, nonce: true },
    });
  }

  /**
   * Advance the nonce WITHIN a caller's transaction and return the full
   * derivation context (serverSeed included — SERVER-SIDE ONLY, never serialized
   * to the client). Used by game engines so the nonce consumption is atomic with
   * settlement. The ensure-exists step and the increment both run on `tx` —
   * issuing the ensure on `this.prisma` instead would grab a second pool
   * connection while `tx` holds one, and under concurrency that exhausts the
   * pool (P2028 "Unable to start a transaction in the given time").
   *
   * `create()` (not `upsert`) + catch-P2002 mirrors `getOrCreateActivePair`:
   * a user's first-ever concurrent calls (e.g. joining two open flips at once)
   * race to insert the same row, and Prisma's upsert isn't atomic against that
   * — the loser would otherwise throw an uncaught unique-violation.
   */
  async consumeNonce(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<{ serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: bigint }> {
    const existing = await tx.clientSeed.findUnique({ where: { userId } });
    if (!existing) {
      try {
        await tx.clientSeed.create({
          data: { userId, clientSeed: generateClientSeed(), nonce: BigInt(0), ...this.mintPair() },
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    return tx.clientSeed.update({
      where: { userId },
      data: { nonce: { increment: 1 } },
      select: { serverSeed: true, serverSeedHash: true, clientSeed: true, nonce: true },
    });
  }
}
