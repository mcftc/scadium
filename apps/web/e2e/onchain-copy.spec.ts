import { test, expect, type Page } from '@playwright/test';

/**
 * On-chain marketing copy must only render when on-chain settlement is genuinely
 * live (#42, #142). We stub `/vault/config` (the source `useChainEnabled` reads)
 * at the network layer so each state is deterministic without a running API.
 */
async function stubChain(page: Page, enabled: boolean) {
  // Match the api-client's `${NEXT_PUBLIC_API_URL}/api/v1/vault/config` URL
  // regardless of host (the CI job pins NEXT_PUBLIC_API_URL to localhost:3000).
  await page.route('**/api/v1/vault/config*', (route) =>
    route.fulfill({ json: { enabled, programId: null } }),
  );
}

test.describe('on-chain copy gating', () => {
  test('about page hides on-chain custody + settlement copy in play-money mode', async ({
    page,
  }) => {
    await stubChain(page, false);
    await page.goto('/about');
    await expect(page.getByText(/play-money beta/i).first()).toBeVisible();
    await expect(page.getByText(/funds live in on-chain vaults you control/i)).toHaveCount(0);
    await expect(page.getByText(/every payout settled on-chain/i)).toHaveCount(0);
  });

  test('about page shows on-chain copy when the chain is enabled', async ({ page }) => {
    await stubChain(page, true);
    await page.goto('/about');
    await expect(page.getByText(/funds live in on-chain vaults you control/i)).toBeVisible();
    await expect(page.getByText(/every payout settled on-chain/i)).toBeVisible();
  });

  test('faq hides the on-chain vault-PDA deposit claim in play-money mode', async ({ page }) => {
    await stubChain(page, false);
    await page.goto('/faq');
    await expect(page.getByText(/on-chain vault pda/i)).toHaveCount(0);
  });

  test('faq shows the on-chain deposit claim when the chain is enabled', async ({ page }) => {
    await stubChain(page, true);
    await page.goto('/faq');
    await expect(page.getByText(/on-chain vault pda/i)).toBeVisible();
  });

  test('about hides the play-money disclaimer once the chain is enabled', async ({ page }) => {
    await stubChain(page, true);
    await page.goto('/about');
    await expect(page.getByText(/play-money beta/i)).toHaveCount(0);
  });
});
