import { test, expect, type Page } from '@playwright/test';

/**
 * Tower UI render smoke (#292). Deterministic and web-only, mirroring mines.spec:
 * the round play-flow LOGIC is covered by the API integration suite
 * (tower-game.e2e-spec.ts). Here we prove the /tower page mounts — the 3D board
 * (2D fallback under reduced motion), the bet control, the provably-fair panel,
 * and the logged-out connect gating — without a running API.
 */
async function stub(page: Page) {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

test.describe('tower page', () => {
  test('renders the board, controls and fairness panel; prompts logged-out visitors to connect', async ({
    page,
  }) => {
    await stub(page);
    await page.goto('/tower');

    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Provably Fair' })).toBeVisible();
    // The 2D fallback renders ROWS×COLUMNS tiles (8×3 = 24).
    await expect(page.getByTestId('tower-tile')).toHaveCount(24);
  });
});
