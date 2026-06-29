import { test, expect, type Page } from '@playwright/test';

/**
 * #44 / #142 — the 18+ age gate must block on first visit and, once confirmed,
 * NEVER reappear (the bug: it flashed on every refresh because it painted into
 * the SSR HTML before hydration read localStorage). This is the browser-level
 * regression lock for the `useHydrated()` fix in `age-gate.tsx`.
 *
 * Web-only: stub `/me` so the anonymous-visitor path is deterministic without an
 * API (an un-acked visitor → gate shown).
 */
async function stubAnon(page: Page) {
  await page.route('**/api/v1/me*', (route) => route.fulfill({ status: 401, json: {} }));
}

test.describe('18+ age gate (#44)', () => {
  test('shows on first visit, then never reappears after confirming or on refresh', async ({
    page,
  }) => {
    await stubAnon(page);

    // First visit: the blocking modal is present.
    await page.goto('/');
    const gate = page.getByRole('dialog', { name: /18\+/i });
    await expect(gate).toBeVisible();

    // Confirm age → modal disappears and the ack persists.
    await page.getByRole('button', { name: /i am 18 or older/i }).click();
    await expect(gate).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('scadium_age_ok'))).toBe('1');

    // Refresh: the gate must NOT flash/reappear for an acked visitor.
    await page.reload();
    await expect(page.getByRole('dialog', { name: /18\+/i })).toHaveCount(0);

    // And again on a fresh navigation within the same origin.
    await page.goto('/about');
    await expect(page.getByRole('dialog', { name: /18\+/i })).toHaveCount(0);
  });

  test('does not reappear when localStorage already holds the ack (no SSR flash)', async ({
    page,
  }) => {
    await stubAnon(page);
    // Seed the ack before any navigation, then load: the gate must never show.
    await page.addInitScript(() => localStorage.setItem('scadium_age_ok', '1'));
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: /18\+/i })).toHaveCount(0);
  });
});
