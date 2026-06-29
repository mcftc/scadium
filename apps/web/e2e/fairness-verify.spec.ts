import { test, expect, type Page } from '@playwright/test';

/**
 * The provably-fair verifier reproduces a game outcome entirely in the browser
 * (WebCrypto HMAC-SHA256 via `@scadium/fair`), with nothing sent to the server —
 * the heart of "provably fair". This spec drives the real form end-to-end so the
 * client-side derivation (which now routes plinko/wheel through the RTP-scaled
 * tables) stays wired up. Web-only; pre-ack the 18+ gate so it doesn't overlay.
 */
async function open(page: Page) {
  // Pre-ack BOTH blocking compliance gates as a returning anonymous user. The
  // legal-gate (#48) is DEFAULT-SHOWN (a z-95 full-screen overlay) until
  // `scadium_legal_version` matches LEGAL_VERSION, so without acking it the
  // overlay intercepts every click on the verifier and the test times out.
  await page.addInitScript(() => {
    localStorage.setItem('scadium_age_ok', '1');
    localStorage.setItem('scadium_legal_version', '2026-06-15'); // = LEGAL_VERSION
  });
  await page.route('**/api/v1/me*', (route) => route.fulfill({ status: 401, json: {} }));
  await page.goto('/fairness');
}

test.describe('provably-fair verifier', () => {
  test('reproduces a dice result locally from seeds', async ({ page }) => {
    await open(page);

    await page.getByRole('button', { name: /^dice$/i }).click();
    await page.getByPlaceholder('64-char hex').fill('deadbeef'.repeat(8));
    await page.getByPlaceholder('client-chosen entropy').fill('player-one');
    await page.getByPlaceholder('0', { exact: true }).fill('0'); // nonce — exact, else the dice "e.g. 50" target also matches "0"
    await page.getByPlaceholder('e.g. 50').fill('50');

    await page.getByRole('button', { name: /^verify$/i }).click();

    // The result card shows the game + a reproduced outcome, computed locally.
    await expect(page.getByText(/dice result/i)).toBeVisible();
    await expect(page.getByText(/computed locally in your browser/i)).toBeVisible();
  });

  test('reproduces a plinko result (scaled payout table) locally', async ({ page }) => {
    await open(page);

    await page.getByRole('button', { name: /^plinko$/i }).click();
    await page.getByPlaceholder('64-char hex').fill('deadbeef'.repeat(8));
    await page.getByPlaceholder('client-chosen entropy').fill('player-one');
    await page.getByPlaceholder('0', { exact: true }).fill('0'); // nonce — exact, else the dice "e.g. 50" target also matches "0"

    await page.getByRole('button', { name: /^verify$/i }).click();

    await expect(page.getByText(/plinko result/i)).toBeVisible();
    // Output looks like "bin N / 16  →  Mx" — a multiplier was rendered.
    await expect(page.getByText(/bin \d+ \/ \d+/i)).toBeVisible();
  });
});
