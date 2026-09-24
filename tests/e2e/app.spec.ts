import { expect, test } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const example = (name: string) => path.resolve(process.cwd(), 'examples', name);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => indexedDB.deleteDatabase('n8n-workflow-visualizer'));
  await page.reload();
});

test('imports peers independently, resolves a later child, switches views, collapses, and restores', async ({ page }) => {
  const input = page.locator('input[type=file]');
  await input.setInputFiles([
    { name: 'synthetic-main.json', mimeType: 'application/json', buffer: readFileSync(example('synthetic-main.json')) },
    { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') },
  ]);
  await expect(page.getByRole('dialog', { name: 'Import results' })).toContainText('1 accepted · 1 skipped');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Content Operations');
  await expect(page.getByText('1 missing reference')).toBeVisible();
  const nodeGeometry = await page.getByTestId('graph-stage').locator('.canvas-node').first().evaluate((node) => {
    const tile = getComputedStyle(node.querySelector('.node-tile')!);
    const footprint = getComputedStyle(node);
    return { footprintWidth: footprint.width, footprintHeight: footprint.height, tileWidth: tile.width, tileHeight: tile.height };
  });
  expect(nodeGeometry).toEqual({ footprintWidth: '100px', footprintHeight: '100px', tileWidth: '64px', tileHeight: '64px' });
  await expect(page.getByTestId('graph-stage').locator('.react-flow__edge-path[d]')).toHaveCount(3);

  await page.getByRole('button', { name: 'Dependency' }).click();
  await expect(page.getByTestId('graph-stage').locator('.dependency-card')).toHaveCount(1);
  await expect(page.getByTestId('graph-stage').locator('.placeholder-card')).toHaveCount(1);

  await input.setInputFiles(example('synthetic-child.json'));
  await page.getByRole('button', { name: 'Close import results' }).click();
  await page.getByText('Content Operations', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Expanded' }).click();
  await expect(page.getByTestId('graph-stage').locator('.workflow-boundary')).toHaveCount(1);
  await expect(page.getByTestId('graph-stage').locator('.boundary-port')).toHaveCount(2);
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(page.getByTestId('graph-stage').locator('.status-collapsed')).toHaveCount(1);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Content Operations');
  await expect(page.getByRole('button', { name: 'Expanded' })).toHaveClass(/is-active/);
});

test('exports both formats and keeps sticky-note payloads inert without external requests', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/i.test(url) && !url.startsWith('http://127.0.0.1:4173')) externalRequests.push(url);
  });
  const hostile = {
    id: 'hostile', name: 'Safe notes', nodes: [
      { id: 'start', name: 'Start', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
      { id: 'note', name: 'Note', type: 'n8n-nodes-base.stickyNote', position: [260, 0], parameters: { width: 320, height: 180, content: '<img src="https://attacker.invalid/a" onerror="window.__xss=1">\n\n![remote](https://attacker.invalid/b)\n\n[bad](javascript:window.__xss=2)' } },
    ], connections: {},
  };
  await page.locator('input[type=file]').setInputFiles({ name: 'hostile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(hostile)) });
  await page.getByRole('button', { name: 'Close import results' }).click();
  await page.getByRole('button', { name: 'Original' }).click();
  await expect(page.getByTestId('graph-stage').locator('.sticky-note')).toContainText('Image blocked');
  expect(await page.evaluate(() => (window as typeof window & { __xss?: number }).__xss)).toBeUndefined();
  expect(externalRequests).toEqual([]);

  const png = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG' }).click();
  expect((await png).suggestedFilename()).toBe('safe-notes-original.png');
  const svg = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SVG' }).click();
  expect((await svg).suggestedFilename()).toBe('safe-notes-original.svg');
});
