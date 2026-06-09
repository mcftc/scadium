import { defineConfig } from 'vitest/config';

// Unit specs live next to the code (`src/**/*.spec.ts`) and need no DB.
// Integration specs (`test/**/*.e2e-spec.ts`) exercise the service→Prisma→
// Postgres path against a dedicated `scadium_test` database; set
// TEST_DATABASE_URL to point at it (default below). Run them serially —
// they share the same DB rows and assert global balance invariants.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
