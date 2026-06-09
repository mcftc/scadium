# API integration tests

Real-Postgres integration + concurrency suites. They boot the full NestJS app
(and drive engines directly) against a dedicated **`scadium_test`** database so
the dev `scadium` DB is never touched.

## Run

```bash
# one-time: create + migrate the test DB
PGPASSWORD=scadium createdb -h localhost -U scadium scadium_test   # or: psql ... -c 'CREATE DATABASE scadium_test;'
DATABASE_URL=postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public \
  pnpm --filter @scadium/api exec prisma migrate deploy

# run the integration suite (serial, fork pool — exits cleanly on its own)
TEST_DATABASE_URL=postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public \
  pnpm --filter @scadium/api test:integration
```

`TEST_DATABASE_URL` defaults to the URL above if unset.

## Harness (`setup.ts`)

- `getPrisma()` — singleton `PrismaClient` bound to the test DB.
- `bootstrapApp()` — sets the env overrides, builds `AppModule`, applies the
  global `ValidationPipe` + `api/v1` prefix from `main.ts`, `app.init()`, and
  returns `{ app, server, prisma, signToken }`. Call `await app.close()` in
  `afterAll`.
- `resetDb()` — `TRUNCATE ... RESTART IDENTITY CASCADE` over every table.
- `seedUser(balance, signToken)` — creates a `User` with an explicit balance
  (the schema default is 10 SOL) and returns `{ user, token }`.

The harness sets `process.env.DATABASE_URL` to the test DB **before** importing
`AppModule`, so `PrismaService` (`new PrismaClient()`) and the harness Prisma
point at the same `scadium_test` DB.

## Notes

- Run with `pool: 'forks'` + `fileParallelism: false` (see
  `vitest.integration.config.ts`): the crash/jackpot/lottery engines start raw
  `setTimeout` round loops in `onModuleInit`; `app.close()` plus the fork pool
  ensure the run exits without hanging.
- `concurrency.e2e-spec.ts` HTTP bets fire inside the 20s betting window opened
  at boot.
