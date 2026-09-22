import { test, expect, type Page } from '@playwright/test';
import { GAME_CATALOG, parseEnabledGames } from '@scadium/shared';

/**
 * Regression lock for the games gate (registry-driven, not a hand list — a
 * hardcoded pair of lists here is exactly the drift the registry exists to
 * prevent). Split from the registry itself:
 *   - every ENABLED game must render its shell without crashing (no Next
 *     error overlay, no empty body), so it's reachable/"playable" even before
 *     wallet auth.
 *   - every DISABLED game must 404 at its own route — being off the nav isn't
 *     enough, the route guard (`isGameVisible` + `notFound()` in each page)
 *     has to actually hold the door.
 * Re-enabling a game via `NEXT_PUBLIC_ENABLED_GAMES` flips which bucket it
 * falls into here automatically, with no edit to this file.
 * Web-only: stub the handful of endpoints the shell calls so the run is
 * deterministic without an API, and pre-ack the 18+ gate so it doesn't overlay.
 */
// Sourced from @scadium/shared, not from @/config/games: the web registry pulls
// in lucide-react (React components), which has no business being imported into
// Playwright's Node context. The shared catalogue is pure data and is the same
// source the registry itself derives from, so the two cannot disagree.
const ENABLED_IDS = parseEnabledGames(process.env.NEXT_PUBLIC_ENABLED_GAMES);
const isEnabled = (id: string) => (ENABLED_IDS as readonly string[]).includes(id);

const ENABLED = GAME_CATALOG.filter((g) => isEnabled(g.id));
const DISABLED = GAME_CATALOG.filter((g) => !isEnabled(g.id));

async function stubShell(page: Page) {
  await page.addInitScript(() => localStorage.setItem('scadium_age_ok', '1'));
  await page.route('**/api/v1/me*', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/v1/vault/config*', (route) =>
    route.fulfill({ json: { enabled: false, programId: null } }),
  );
  // Any other API call the shell makes resolves empty rather than hanging.
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
}

test.describe('enabled game pages render (smoke)', () => {
  for (const game of ENABLED) {
    test(`${game.href} renders without crashing`, async ({ page }) => {
      await stubShell(page);
      const resp = await page.goto(game.href);
      expect(resp?.status() ?? 200, `${game.href} HTTP status`).toBeLessThan(400);

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

test.describe('disabled game routes 404 (gate regression lock)', () => {
  for (const game of DISABLED) {
    test(`${game.href} 404s`, async ({ page }) => {
      await stubShell(page);
      const resp = await page.goto(game.href);
      // The contract is the STATUS plus the absence of the game — deliberately
      // not Next's own 404 wording, which renders client-side behind a Suspense
      // boundary and is free to change between Next versions.
      expect(resp?.status() ?? 200, `${game.href} HTTP status`).toBe(404);
      await expect(
        page.getByRole('button', { name: /place bet|bet|roll|spin|deal/i }),
        `${game.href} must not render game controls`,
      ).toHaveCount(0);
    });
  }
});
