import { test, expect, type Page } from '@playwright/test';

/**
 * Mines UI render smoke (#291). Deterministic and web-only, mirroring vault.spec:
 * the round play-flow LOGIC is fully covered by the API integration suite
 * (mines-game.e2e-spec.ts — start/pick/cashout/bust/idempotency), so here we just
 * prove the new /mines page mounts — the 3D board (with its 2D fallback under
 * reduced motion), the bet + mine-count controls, the provably-fair panel, and
 * the logged-out connect gating — without a running API.
 */
async function stub(page: Page) {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.emulateMedia({ reducedMotion: 'reduce' }); // force the GameStage 2D fallback
}

test.describe('mines page', () => {
  test('renders the board, controls and fairness panel; prompts logged-out visitors to connect', async ({
    page,
  }) => {
    await stub(page);
    await page.goto('/mines');

    // The controls card is rendered with its connect gate (logged out).
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    // The provably-fair disclosure renders.
    await expect(page.getByRole('heading', { name: 'Provably Fair' })).toBeVisible();
    // The 2D fallback board renders its 25 tiles (3D canvas is suppressed under
    // reduced motion).
    await expect(page.getByTestId('mines-tile')).toHaveCount(25);
  });
});
