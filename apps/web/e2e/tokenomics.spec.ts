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

    // Revenue redistribution: $SCAD has NO buy-and-burn (removed) — the whole
    // slice goes to holders: 12% staking dividends + 8% vault = 20% of NGR.
    await expect(page.getByText(/no buy-and-burn/i).first()).toBeVisible();
    await expect(page.getByText(/buy & burn/i)).toHaveCount(0);
    await expect(page.getByText(/staking dividends/i)).toBeVisible();
    await expect(page.getByText(/vault yield/i)).toBeVisible();
    await expect(page.getByText(/of net gaming revenue/i).first()).toBeVisible();

    // Emission MUST be the Proof-of-Play 4-year-halving mining model — NOT the
    // removed per-bet "128 $SCAD per 1 SOL wagered" mint nor the old phase model.
    await expect(page.getByText(/Proof-of-Play mining/i).first()).toBeVisible();
    await expect(page.getByText(/halves every 4 years/i)).toBeVisible();
    // The engine economy must be documented: USDS staking dividends + the term Vault.
    await expect(page.getByText(/USDS/).first()).toBeVisible();
    await expect(page.getByText(/Vault/i).first()).toBeVisible();
    await expect(page.getByText(/128 \$SCAD per 1 SOL wagered/i)).toHaveCount(0);
  });
});
