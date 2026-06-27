import { test, expect, Page } from '@playwright/test';

// The connection overlay drives two heavy synchronous D3 renders per test (focal
// + route). Run this file's tests serially so only one such render competes for
// CPU at a time — they stay reliable alongside the parallel phase6/7 specs.
test.describe.configure({ mode: 'serial' });

const APP = 'http://localhost:3000';
const NODE = 'g.hs-node';
const LINK = 'line.hs-link';
const ROUTE_LINK = 'line.hs-link[data-route="1"]';
const ENDPOINT = 'circle.hs-endpoint';
const FOCAL_BODY = `${NODE}:has(circle[stroke="var(--focal)"]) circle.body`;
const CONTROLS = 'div:has-text("עומק"):has(input[type="range"])';

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

// Arm "trace connection" from the current focal entity, then pick a destination
// by typing its name (which may resolve to a currently-hidden entity).
async function traceFromFocalByName(page: Page, target: string) {
  await page.locator(FOCAL_BODY).click();
  await page.getByRole('button', { name: /מציאת קשר/ }).click();
  await search(page, target);
  await page.locator('[role="listbox"] button').first().click();
}

// AC-5 + AC-1: trace + a second endpoint chosen by typing overlays the routes in
// focus mode, with endpoint rings, the control strip, and edge-click provenance.
test('trace connection by typing a destination lights up the route in focus mode', async ({ page }) => {
  test.slow(); // two heavy D3 renders (focal + route); generous under parallel load
  await openFocal(page, 'נתניהו');
  await traceFromFocalByName(page, 'ארצות הברית');

  // Route edges are flagged and lit; both endpoints get distinct rings.
  await page.waitForSelector(ROUTE_LINK, { timeout: 25000 });
  expect(await page.locator(ROUTE_LINK).count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator(ENDPOINT).count(), { timeout: 5000 }).toBe(2);

  // The connection control strip is visible with its A↔B summary + path count.
  await expect(page.locator(CONTROLS).first()).toBeVisible();
  await expect(page.getByText(/מסלולים|אין מסלול/).first()).toBeVisible();

  // Provenance survives focus mode: a route edge still opens the sources panel.
  await page.locator(`${ROUTE_LINK}`).first().click({ force: true });
  await expect(page.locator('aside:has-text("RELATION")')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'screenshots/p8-route.png', fullPage: true });
});

// AC-3: the hub cutoff suppresses routes through mega-hubs by default and reports
// it; the "include major hubs" toggle restores them.
test('major hubs are suppressed by default and the toggle restores them', async ({ page }) => {
  test.slow();
  await openFocal(page, 'נתניהו');
  await traceFromFocalByName(page, 'ארצות הברית');
  await page.waitForSelector(ROUTE_LINK, { timeout: 25000 });

  // The strip names the suppressed hub(s) it bypassed (e.g. הליכוד) and offers to show them.
  const showHubs = page.getByRole('button', { name: /הצגת צמתים מרכזיים|להצגתם|הכללת צמתים/ }).first();
  await expect(showHubs).toBeVisible({ timeout: 5000 });
  await showHubs.click();
  // After including hubs, the route re-runs and still renders.
  await expect.poll(() => page.locator(ROUTE_LINK).count(), { timeout: 8000 }).toBeGreaterThan(0);
  await page.screenshot({ path: 'screenshots/p8-hubs.png', fullPage: true });
});

// AC-6: clear exits connection mode but keeps the accumulated graph; AC-5 also
// covers picking the destination by clicking a displayed node.
test('clicking a node as destination traces it, and clear returns to exploration', async ({ page }) => {
  test.slow();
  await openFocal(page, 'נתניהו');

  // Arm from the focal, then pick a destination by clicking a visible neighbor.
  await page.locator(FOCAL_BODY).click();
  await page.getByRole('button', { name: /מציאת קשר/ }).click();
  const neighborBody = page.locator(`${NODE}:not(:has(circle[stroke="var(--focal)"])) circle.body`).first();
  await neighborBody.click({ force: true });

  await page.waitForSelector(ROUTE_LINK, { timeout: 25000 });
  const nodesDuring = await page.locator(NODE).count();
  expect(nodesDuring).toBeGreaterThan(0);

  // Clear exits focus mode (no route links, no control strip) but keeps the graph.
  await page.getByRole('button', { name: 'סגירת מצב חיבור' }).click();
  await expect.poll(() => page.locator(ROUTE_LINK).count(), { timeout: 5000 }).toBe(0);
  await expect(page.locator(CONTROLS)).toHaveCount(0);
  expect(await page.locator(NODE).count()).toBe(nodesDuring);
  await page.screenshot({ path: 'screenshots/p8-cleared.png', fullPage: true });
});
