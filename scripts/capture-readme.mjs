import { chromium } from '@playwright/test';
import path from 'node:path';

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173');
await page.evaluate(() => indexedDB.deleteDatabase('n8n-workflow-visualizer'));
await page.reload();
await page.locator('input[type=file]').setInputFiles([
  path.resolve('examples/synthetic-main.json'),
  path.resolve('examples/synthetic-child.json'),
]);
await page.getByRole('button', { name: 'Close import results' }).click();
await page.getByText('Content Operations', { exact: true }).first().click();
await page.getByRole('button', { name: 'View', exact: true }).click();
await page.getByRole('button', { name: 'Reset view' }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: path.resolve('docs/assets/readme.png') });
await browser.close();
