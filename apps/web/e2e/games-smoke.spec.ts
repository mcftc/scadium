import { test, expect, type Page } from '@playwright/test';

/**
 * Every game page must render its shell without crashing (no Next error overlay,
 * no empty body), so the games are reachable/"playable" even before wallet auth.
 * Web-only: stub the handful of endpoints the shell calls so the run is
 * deterministic without an API, and pre-ack the 18+ gate so it doesn't overlay.
 */
const GAMES = [
  'crash',
  'coinflip',
  'dice',
  'limbo',
  'wheel',
  'plinko',
  'mines',
  'hilo',
  'tower',
  'jackpot',
  'lottery',
  'blackjack',
] as const;

async function stubShell(page: Page) {
  await page.addInitScript(() => localStorage.setItem('scadium_age_ok', '1'));
  await page.route('**/api/v1/me*', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/v1/vault/config*', (route) =>
    route.fulfill({ json: { enabled: false, programId: null } }),
  );
  // Any other API call the shell makes resolves empty rather than hanging.
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
}

test.describe('game pages render (smoke)', () => {
  for (const game of GAMES) {
    test(`/${game} renders without crashing`, async ({ page }) => {
      await stubShell(page);
      const resp = await page.goto(`/${game}`);
      expect(resp?.status() ?? 200, `/${game} HTTP status`).toBeLessThan(400);

      // The app shell mounted (main region present) …
      await expect(page.locator('main')).toBeVisible();
      // … and Next did not render an error / not-found page.
      await expect(page.getByText(/application error/i)).toHaveCount(0);
      await expect(page.getByText(/this page could not be found/i)).toHaveCount(0);
      // The 18+ overlay is not blocking (pre-acked).
      await expect(page.getByRole('dialog', { name: /18\+/i })).toHaveCount(0);
    });
  }
});
