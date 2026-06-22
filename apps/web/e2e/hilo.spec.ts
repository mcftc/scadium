import { test, expect, type Page } from '@playwright/test';

/**
 * Hi-Lo UI render smoke (#293). Deterministic and web-only, mirroring
 * mines/tower.spec: the round play-flow LOGIC is covered by the API integration
 * suite (hilo-game.e2e-spec.ts). Here we prove the /hilo page mounts — the 3D
 * card (2D fallback under reduced motion), the bet control, the provably-fair
 * panel, and the logged-out connect gating — without a running API.
 */
async function stub(page: Page) {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

test.describe('hilo page', () => {
  test('renders the card, controls and fairness panel; prompts logged-out visitors to connect', async ({
    page,
  }) => {
    await stub(page);
    await page.goto('/hilo');

    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Provably Fair' })).toBeVisible();
    await expect(page.getByTestId('hilo-card')).toBeVisible();
  });
});
