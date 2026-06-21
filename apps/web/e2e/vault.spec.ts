import { test, expect, type Page } from '@playwright/test';

/**
 * SCAD Vault page render smoke (V7). Pools are public, so the page fetches
 * `/vault/pools` on load regardless of auth — we stub it at the network layer
 * (mirroring onchain-copy.spec) so the render is deterministic without a running
 * API. Asserts the term-pool cards and the live-earnings counter render.
 */
async function stubPools(page: Page) {
  await page.route('**/api/v1/vault/pools*', (route) =>
    route.fulfill({
      json: [
        {
          id: 'p30',
          asset: 'scad',
          termDays: 30,
          weightBps: 1000,
          aprBps: 1200,
          indexRay: '1000000000000000000',
          totalAssets: '0',
          totalShares: '0',
        },
        {
          id: 'p90',
          asset: 'scad',
          termDays: 90,
          weightBps: 2000,
          aprBps: 2400,
          indexRay: '1000000000000000000',
          totalAssets: '0',
          totalShares: '0',
        },
        {
          id: 'p180',
          asset: 'scad',
          termDays: 180,
          weightBps: 3000,
          aprBps: 3600,
          indexRay: '1000000000000000000',
          totalAssets: '0',
          totalShares: '0',
        },
        {
          id: 'p365',
          asset: 'scad',
          termDays: 365,
          weightBps: 4000,
          aprBps: 4800,
          indexRay: '1000000000000000000',
          totalAssets: '0',
          totalShares: '0',
        },
      ],
    }),
  );
}

test.describe('vault page', () => {
  test('renders the term-pool cards and the live earnings counter', async ({ page }) => {
    await stubPools(page);
    await page.goto('/vault');

    await expect(page.getByRole('heading', { name: /SCAD Vault/i })).toBeVisible();
    await expect(page.getByText(/Total earning, live/i)).toBeVisible();
    // All four seeded terms render as selectable cards.
    for (const term of ['30d', '90d', '180d', '365d']) {
      await expect(page.getByText(term, { exact: true }).first()).toBeVisible();
    }
    // Logged-out visitors are prompted to connect, not shown positions.
    await expect(page.getByText(/connect your wallet to lock \$SCAD/i)).toBeVisible();
  });
});
