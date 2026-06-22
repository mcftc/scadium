import { defineConfig, devices } from '@playwright/test';

/**
 * Browser e2e harness for the web app (#142). #42 mandated a Playwright e2e for
 * the on-chain copy gating but the app had no browser-e2e harness — this stands
 * it up. The specs mock `/vault/config` at the network layer (no API/DB needed),
 * so the run is deterministic and web-only. The vitest render test
 * (chain-copy.test.tsx) remains the fast unit-level guard.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  // Heavier pages can take a moment to paint under CI's parallel load; give
  // assertions headroom over the 5s default.
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Serve the production build; CI builds the web app before running e2e.
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
