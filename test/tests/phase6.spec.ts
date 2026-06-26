import { test, expect, Page } from '@playwright/test';

const APP = 'http://localhost:3000';
const NODE = 'g.hs-node';
const EXPANDER = 'g.hs-expander';

async function search(page: Page, term: string) {
  const input = page.locator('input').first();
  await input.click();
  await input.fill(term);
  await page.waitForSelector('[role="listbox"] button', { timeout: 10000 });
}

async function openFocal(page: Page, term: string) {
  await page.goto(APP);
  await page.waitForSelector('input', { timeout: 15000 });
  await search(page, term);
  await page.locator('[role="listbox"] button').first().click();
  await page.waitForSelector(NODE, { timeout: 10000 });
}

test('app opens to a search-first landing with suggestions', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByRole('heading', { name: 'הון־שלטון' })).toBeVisible();
  await expect(page.locator('input').first()).toBeVisible();
  // Suggested entities (top by degree) are offered as file-tab chips.
  await page.waitForSelector('[data-suggestion]', { timeout: 10000 });
  expect(await page.locator('[data-suggestion]').count()).toBeGreaterThan(0);
  await page.screenshot({ path: 'screenshots/p6-landing.png', fullPage: true });
});

test('searching by name renders the focal entity + its 1-hop neighbors', async ({ page }) => {
  await openFocal(page, 'עמית');
  // Focal entity is emphasized with the amber ring.
  await expect(page.locator(`${NODE} circle[stroke="var(--focal)"]`).first()).toBeVisible();
  // Its direct neighbors are present (more than just the focal node).
  expect(await page.locator(NODE).count()).toBeGreaterThan(1);
  await page.screenshot({ path: 'screenshots/p6-focal.png', fullPage: true });
});

test('expanding a neighbor fetches and merges its neighbors incrementally', async ({ page }) => {
  await openFocal(page, 'בית המשפט');
  const before = await page.locator(NODE).count();
  expect(await page.locator(EXPANDER).count()).toBeGreaterThan(0);

  await page.locator(EXPANDER).first().click();
  // The graph grows by at least one node as the neighbor's links merge in.
  await expect.poll(() => page.locator(NODE).count(), { timeout: 10000 }).toBeGreaterThan(before);
  await page.screenshot({ path: 'screenshots/p6-expanded.png', fullPage: true });
});

test('clicking a node opens the RTL details panel with an expand action', async ({ page }) => {
  await openFocal(page, 'עמית');
  await page.locator(`${NODE} circle.body`).first().click();
  await expect(page.getByRole('button', { name: /הרחבת הקשרים/ })).toBeVisible();
  await page.screenshot({ path: 'screenshots/p6-panel.png', fullPage: true });
});

test('a fresh search re-centers on a new focal entity', async ({ page }) => {
  await openFocal(page, 'עמית');
  // Use the persistent top-bar search to pivot to a different entity.
  await search(page, 'הכנסת');
  await page.locator('[role="listbox"] button').first().click();
  await page.waitForSelector(`${NODE} circle[stroke="var(--focal)"]`, { timeout: 10000 });
  expect(await page.locator(NODE).count()).toBeGreaterThan(0);
});
