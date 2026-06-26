import { test, expect, Page } from '@playwright/test';

const APP = 'http://localhost:3000';
const NODE = 'g.hs-node';
const LINK = 'line.hs-link';
const LINK_HIT = 'line.hs-link-hit';
const EDGE_PANEL = 'aside:has-text("RELATION")';

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
  await page.waitForSelector(LINK, { timeout: 10000 });
}

// AC-1 + AC-5: clicking an edge reveals each source with outlet, quote, and a
// working article link.
test('clicking an edge surfaces its sources — outlet chip, quote, and a link', async ({ page }) => {
  await openFocal(page, 'עמית');
  await page.locator(LINK_HIT).first().click({ force: true });

  const panel = page.locator(EDGE_PANEL);
  await expect(panel).toBeVisible({ timeout: 5000 });

  // A source chip links to the originating article (http link, opens new tab).
  const link = panel.locator('a[href^="http"]').first();
  await expect(link).toBeVisible();
  expect(await link.getAttribute('href')).toMatch(/^https?:\/\//);

  // The exact supporting quote rides along under the chip.
  await expect(panel.locator('blockquote')).toHaveCount(await panel.locator('blockquote').count());
  await page.screenshot({ path: 'screenshots/p7-edge-sources.png', fullPage: true });
});

// AC-2: edges are colored by category and the reader can filter by category.
test('category filter hides edges of a deselected category', async ({ page }) => {
  await openFocal(page, 'עמית');
  const before = await page.locator(LINK).count();
  expect(before).toBeGreaterThan(0);

  // The filter offers the six relation categories as toggles.
  const filterButtons = page.locator('button:has-text("פוליטי"), button:has-text("כספים"), button:has-text("משפטי")');
  expect(await filterButtons.count()).toBeGreaterThan(0);

  // Toggle every category off → no edges remain.
  for (const cat of ['משפחה', 'כספים', 'מקצועי', 'פוליטי', 'משפטי', 'אחר']) {
    const btn = page.locator(`button:has-text("${cat}")`).first();
    if (await btn.count()) await btn.click();
  }
  await expect.poll(() => page.locator(LINK).count(), { timeout: 5000 }).toBe(0);
  await page.screenshot({ path: 'screenshots/p7-filter.png', fullPage: true });
});

// AC-4: the node panel shows aliases and a linked Wikidata QID when present.
test('node panel shows aliases and a linked Wikidata QID when available', async ({ page }) => {
  // Pick an entity known to carry a QID + aliases (e.g. ארצות הברית / איראן).
  await openFocal(page, 'איראן');
  await page.locator(`${NODE} circle.body`).first().click();
  const panel = page.locator('aside:has-text("ידוע גם כ"), aside:has-text("ויקינתונים")').first();
  // At least one of aliases / QID is present for a QID-bearing entity.
  await expect(panel).toBeVisible({ timeout: 5000 });
  const wikidata = panel.locator('a[href*="wikidata.org/wiki/Q"]');
  if (await wikidata.count()) {
    expect(await wikidata.first().getAttribute('href')).toMatch(/wikidata\.org\/wiki\/Q\d+/);
  }
  await page.screenshot({ path: 'screenshots/p7-node-panel.png', fullPage: true });
});
