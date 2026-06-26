import { chromium } from '@playwright/test';

const APP = 'http://localhost:3000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });

async function selectFocal(term) {
  const input = page.locator('input').first();
  await input.click();
  await input.fill(term);
  await page.waitForSelector('[role="listbox"] button', { timeout: 10000 });
  await page.locator('[role="listbox"] button').first().click();
  await page.waitForSelector('g.hs-node', { timeout: 10000 });
  await page.waitForTimeout(1000);
}

await page.goto(APP);
await page.waitForSelector('[data-suggestion]', { timeout: 15000 });
await page.screenshot({ path: 'screenshots/hi-landing.png' });

await selectFocal('נתניהו');
await page.screenshot({ path: 'screenshots/hi-focal.png' });

const exp = page.locator('g.hs-expander');
if (await exp.count()) {
  await exp.first().click();
  await page.waitForTimeout(1300);
}
await page.screenshot({ path: 'screenshots/hi-expanded.png' });

await page.locator('g.hs-node circle.body').first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: 'screenshots/hi-panel.png' });

await browser.close();
console.log('done');
