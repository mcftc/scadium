import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// Integration suite (real Postgres). Runs the full NestJS app over HTTP plus
// direct-engine settlement specs against the dedicated `scadium_test` DB.
//
// The swc plugin compiles with `decorators` + `emitDecoratorMetadata` so
// NestJS constructor dependency-injection works under vitest (esbuild, the
// default transform, does NOT emit decorator metadata → providers like
// PrismaService would inject as `undefined`).
//
// `pool: 'forks'` + `fileParallelism: false` keep the run serial AND let the
// worker process be force-terminated at the end — the crash/jackpot/lottery
// engines schedule raw `setTimeout` round loops in `onModuleInit` that would
// otherwise keep the event loop alive and hang the run. `app.close()` in the
// suite's afterAll handles graceful teardown; the fork pool is the backstop.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2021',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
