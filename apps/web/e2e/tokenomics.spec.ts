import { test, expect } from '@playwright/test';

/**
 * The $SCAD whitepaper must reflect the engine's CURRENT tokenomics (it used to
 * hard-code a stale pre-Vault model: 217,755,972 supply, a 40% "future rewards"
 * bucket, and a flat 20% buy-and-burn). It now derives every number from the
 * `@scadium/shared` ENGINE constants, so this spec locks it to the live model:
 * 1B fixed supply, the 6-way allocation, and the 6/6/8 NGR redistribution.
 *
 * Static page — no API needed.
 */
test.describe('$SCAD whitepaper tokenomics', () => {
  test('shows the current 1B supply + 6-way allocation, not the stale model', async ({ page }) => {
    await page.goto('/whitepaper');

    // Fixed 1B max supply (was 217,755,972).
    await expect(page.getByText('1,000,000,000').first()).toBeVisible();
    await expect(page.getByText('217,755,972')).toHaveCount(0);

    // 6-way allocation buckets.
    await expect(page.getByText(/Play-to-Earn emission/i)).toBeVisible();
    await expect(page.getByText(/Treasury \/ Ecosystem \/ MM/i)).toBeVisible();
    await expect(page.getByText(/Strategic/i)).toBeVisible();
    // The stale "Future rewards: 40%" bucket is gone.
    await expect(page.getByText(/Future rewards/i)).toHaveCount(0);

    // Revenue redistribution streams (6% burn / 6% dividends / 8% vault = 20%).
    await expect(page.getByText(/buy & burn/i).first()).toBeVisible();
    await expect(page.getByText(/staking dividends/i)).toBeVisible();
    await expect(page.getByText(/vault yield/i)).toBeVisible();
    await expect(page.getByText(/of net gaming revenue/i).first()).toBeVisible();
  });
});
