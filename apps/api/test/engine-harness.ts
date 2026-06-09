import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CrashEngine } from '../src/games/crash/crash.engine';
import { JackpotEngine } from '../src/games/jackpot/jackpot.engine';
import { LotteryEngine } from '../src/games/lottery/lottery.engine';
import { BlackjackEngine } from '../src/games/blackjack/blackjack.engine';

/**
 * Shared bootstrap for direct-engine integration specs (settlement-atomicity,
 * round-recovery, and the per-engine settlement specs from #62). These specs
 * construct engines OUTSIDE NestJS DI and drive their private settle paths
 * against real test Postgres — so this harness must NOT import `setup.ts`
 * (which boots the full AppModule as a side effect). It just builds a
 * PrismaClient on TEST_DATABASE_URL, like the specs used to inline.
 *
 * Folds in the duplicated bootstrap the specs previously copy-pasted
 * (the open #9 TODO).
 */
export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public';

export const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

/** No-op gateway stub: any method access returns a no-op fn. */
export const gw = () => new Proxy({}, { get: () => () => undefined }) as never;
/** Disabled chain stub: every `chain.enabled`/`lotteryEnabled` branch is skipped. */
export const offChain = { enabled: false, lotteryEnabled: false } as never;

/** A user with a known play balance + globally-unique wallet/refCode (no resetDb). */
export async function makeUser(balance: bigint) {
  const id = randomUUID();
  return prisma.user.create({
    data: {
      walletAddress: `eng-${id}`,
      refCode: `eng-ref-${id}`,
      playBalanceLamports: balance,
    },
  });
}

/** A committed seed row (serverSeed present so settles can reveal it). */
export async function makeSeed() {
  const id = randomUUID();
  return prisma.seed.create({
    data: { serverSeed: `srv-${id}`, serverSeedHash: `hash-${id}`, clientSeed: `cli-${id}`, nonce: 0 },
  });
}

// Engine factories — all pass `offChain` as the 3rd ctor arg (the chain).
export const makeCrashEngine = () => new CrashEngine(prisma as never, gw(), offChain);
export const makeJackpotEngine = () => new JackpotEngine(prisma as never, gw(), offChain);
export const makeLotteryEngine = () => new LotteryEngine(prisma as never, gw(), offChain);
export const makeBlackjackEngine = () => new BlackjackEngine(prisma as never, gw(), offChain);
