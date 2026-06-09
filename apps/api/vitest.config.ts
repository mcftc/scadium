import { defineConfig } from 'vitest/config';

// Unit specs live next to the code (`src/**/*.spec.ts`) and need no DB.
// Integration specs (`test/**/*.e2e-spec.ts`) exercise the service→Prisma→
// Postgres path against a dedicated `scadium_test` database; set
// TEST_DATABASE_URL to point at it (default below). Run them serially —
// they share the same DB rows and assert global balance invariants.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    // The umbrella concurrency suite boots the full NestJS AppModule, which
    // needs decorator metadata for constructor DI — only the swc-enabled
    // `vitest.integration.config.ts` provides that. Run it via `test:integration`.
    exclude: ['**/node_modules/**', '**/dist/**', 'test/concurrency.e2e-spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
