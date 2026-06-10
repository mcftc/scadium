/**
 * Shared real-Postgres integration harness (GitHub #9).
 *
 * Every roadmap integration suite reuses this: it boots the FULL NestJS
 * AppModule against a dedicated `scadium_test` Postgres database (never the
 * dev `scadium` DB), mirrors the global pipes/prefix from `main.ts`, and hands
 * back a supertest-ready server plus a BigInt-safe Prisma client and helpers
 * to mint JWTs / seed users / reset DB state between tests.
 *
 * CRITICAL ordering: the AppModule's ConfigModule loads the root `.env` whose
 * `DATABASE_URL` points at the DEV db, and dotenv does NOT override an existing
 * `process.env`. PrismaService constructs `new PrismaClient()` reading
 * `process.env.DATABASE_URL` at construction time. So we MUST set the test DB
 * URL on `process.env` BEFORE importing AppModule / building the app — that is
 * done at the top of this module (import side effect) so any spec that imports
 * the harness gets the override regardless of import order.
 */
import { PrismaClient } from '@prisma/client';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public';

// Point the app (and its PrismaService) at the test DB before AppModule loads.
process.env.DATABASE_URL = TEST_DATABASE_URL;
// ≥32 bytes — the API fails closed below that (#33).
process.env.JWT_SECRET ??= 'test-secret-at-least-32-bytes-long!!';

// Lazily-imported Nest types/values so the env override above runs first.
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

// All tables in the schema (no @@map directives → model name == table name).
// CASCADE handles FK ordering; RESTART IDENTITY zeroes any serial counters.
const ALL_TABLES = [
  'User',
  'LinkedWallet',
  'Session',
  'Seed',
  'Bet',
  'CrashRound',
  'CrashBet',
  'ScheduledCrashBet',
  'CoinflipGame',
  'LotteryDraw',
  'LotteryTicket',
  'JackpotRound',
  'JackpotEntry',
  'BlackjackTable',
  'BlackjackRound',
  'ChatMessage',
  'AirdropEvent',
  'AirdropPool',
  'AirdropClaim',
  'RewardClaim',
  'TokenBurn',
  'Referral',
  'LeaderboardSnapshot',
  'SettlementFailure',
] as const;

let prismaSingleton: PrismaClient | undefined;

/** Singleton PrismaClient bound to the test DB — shared across the run. */
export function getPrisma(): PrismaClient {
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
    });
  }
  return prismaSingleton;
}

/** Truncate every game/user table. Safe to call in `beforeEach`. */
export async function resetDb(prisma: PrismaClient = getPrisma()): Promise<void> {
  const list = ALL_TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

export interface BootstrapResult {
  app: INestApplication;
  server: Server;
  prisma: PrismaClient;
  /** Sign a JWT the same way the app verifies it (userId/walletAddress claims). */
  signToken: (userId: string, walletAddress: string) => Promise<string>;
}

/**
 * Build + init the full app over real Postgres, mirroring main.ts global
 * config. Returns a supertest-ready http server and helpers. Call
 * `await app.close()` in `afterAll`.
 */
export async function bootstrapApp(): Promise<BootstrapResult> {
  // Imported here (not top-level) so the process.env override above is applied
  // before AppModule / its providers are evaluated.
  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { JwtService } = await import('@nestjs/jwt');
  const { AppModule } = await import('../src/app.module');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  // Mirror main.ts exactly so DTO validation + routing match production.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // Listen on an ephemeral port: a real listening socket handles many
  // concurrent supertest requests cleanly. Firing N parallel requests at a
  // non-listening server (supertest's per-request ephemeral bind) races on the
  // same http.Server and resets connections — which the double-spend test does.
  await app.listen(0);

  const jwt = app.get(JwtService);
  const { randomUUID } = await import('node:crypto');
  // Mint an access token AND back it with a live Session row (#35) — the guard
  // now rejects any access token whose jti has no live session.
  const signToken = async (userId: string, walletAddress: string): Promise<string> => {
    const jti = randomUUID();
    const token = await jwt.signAsync({ sub: userId, userId, walletAddress, typ: 'access', jti });
    await getPrisma().session.create({
      data: {
        userId,
        jwtId: jti,
        refreshToken: `harness-refresh-${jti}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    return token;
  };

  return { app, server: app.getHttpServer() as Server, prisma: getPrisma(), signToken };
}

let userSeq = 0;
const RUN = Date.now().toString(36);

export interface SeededUser {
  user: { id: string; walletAddress: string; playBalanceLamports: bigint };
  token: string;
}

/**
 * Create a User with an explicit play balance (the schema default is 10 SOL,
 * so callers that want a known balance MUST go through here) and a signed JWT.
 * Requires a booted app for `signToken` — pass the bootstrap result's helper.
 */
export async function seedUser(
  balance: bigint,
  signToken: BootstrapResult['signToken'],
  prisma: PrismaClient = getPrisma(),
): Promise<SeededUser> {
  userSeq += 1;
  const wallet = `harness-${RUN}-${userSeq}`;
  const user = await prisma.user.create({
    data: {
      walletAddress: wallet,
      refCode: `harness-ref-${RUN}-${userSeq}`,
      playBalanceLamports: balance,
    },
  });
  const token = await signToken(user.id, user.walletAddress);
  return { user, token };
}
