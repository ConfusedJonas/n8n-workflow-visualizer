import { chromium } from '@playwright/test';
import path from 'node:path';

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const baseUrl = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173';

async function openCleanPage() {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('n8n-workflow-visualizer');
    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve(undefined);
  }));
  await page.reload();
  return { context, page };
}

async function importWorkflows(page, filenames) {
  await page.locator('input[type=file]').setInputFiles(filenames.map((filename) => path.resolve('examples', filename)));
  await page.getByRole('button', { name: 'Close import results' }).click();
  await page.getByText('Content Operations', { exact: true }).first().click();
}

{
  const { context, page } = await openCleanPage();
  await importWorkflows(page, ['synthetic-main.json', 'synthetic-child.json']);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.resolve('docs/assets/readme.png') });
  await context.close();
}

for (const example of [
  { files: ['synthetic-main.json'], output: 'dependency-missing.png' },
  { files: ['synthetic-main.json', 'synthetic-child.json'], output: 'dependency-complete.png' },
]) {
  const { context, page } = await openCleanPage();
  await importWorkflows(page, example.files);
  await page.getByRole('button', { name: 'Dependency', exact: true }).click();
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.resolve('docs/assets', example.output) });
  await context.close();
}

await browser.close();
