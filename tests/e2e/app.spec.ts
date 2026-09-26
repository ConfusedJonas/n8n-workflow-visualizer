import { expect, test } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const example = (name: string) => path.resolve(process.cwd(), 'examples', name);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('imports peers independently, resolves a later child, switches views, collapses, and restores', async ({ page }) => {
  const input = page.locator('input[type=file]');
  await input.setInputFiles([
    { name: 'synthetic-main.json', mimeType: 'application/json', buffer: readFileSync(example('synthetic-main.json')) },
    { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') },
  ]);
  await expect(page.getByRole('dialog', { name: 'Import results' })).toContainText('1 accepted · 1 skipped');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Content Operations');
  await expect(page.locator('.warning-link')).toContainText('1 missing dependency · Click to view');
  const nodeGeometry = await page.getByTestId('graph-stage').locator('.canvas-node').first().evaluate((node) => {
    const tile = getComputedStyle(node.querySelector('.node-tile')!);
    const footprint = getComputedStyle(node);
    return { footprintWidth: footprint.width, footprintHeight: footprint.height, tileWidth: tile.width, tileHeight: tile.height };
  });
  expect(nodeGeometry).toEqual({ footprintWidth: '100px', footprintHeight: '80px', tileWidth: '100px', tileHeight: '80px' });
  await expect(page.getByTestId('graph-stage').locator('svg[aria-label="HTTP Request"]')).toHaveCount(1);
  await expect(page.getByTestId('graph-stage').locator('.react-flow__edge-path[d]')).toHaveCount(3);

  await page.getByText('Highlight missing').click();
  await expect(page.getByTestId('graph-stage')).toHaveClass(/highlight-missing/);
  await page.locator('.warning-link').click();
  await expect(page.getByRole('button', { name: 'Dependency', exact: true })).toHaveClass(/is-active/);
  await expect(page.getByTestId('graph-stage').locator('.dependency-card')).toHaveCount(1);
  await expect(page.getByTestId('graph-stage').locator('.placeholder-card')).toHaveCount(1);

  await input.setInputFiles(example('synthetic-child.json'));
  await page.getByRole('button', { name: 'Close import results' }).click();
  await page.getByText('Content Operations', { exact: true }).first().click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByTestId('graph-stage').locator('.workflow-boundary')).toHaveCount(1);
  await expect(page.getByTestId('graph-stage').locator('.boundary-port')).toHaveCount(4);
  await expect(page.getByTestId('graph-stage').locator('.status-boundary-entry')).toHaveCount(1);
  await expect(page.getByTestId('graph-stage').locator('.status-boundary-exit')).toHaveCount(1);
  const boundaryBefore = await page.getByTestId('graph-stage').locator('.workflow-boundary').boundingBox();
  const childBefore = await page.getByTestId('graph-stage').locator('.react-flow__node').filter({ hasText: 'Research context' }).boundingBox();
  if (!boundaryBefore || !childBefore) throw new Error('Expanded workflow geometry was unavailable.');
  await page.mouse.move(boundaryBefore.x + 24, boundaryBefore.y + 22);
  await page.mouse.down();
  await page.mouse.move(boundaryBefore.x + 54, boundaryBefore.y + 42, { steps: 5 });
  await page.mouse.up();
  const boundaryAfter = await page.getByTestId('graph-stage').locator('.workflow-boundary').boundingBox();
  const childAfter = await page.getByTestId('graph-stage').locator('.react-flow__node').filter({ hasText: 'Research context' }).boundingBox();
  if (!boundaryAfter || !childAfter) throw new Error('Moved workflow geometry was unavailable.');
  expect(childAfter.x - childBefore.x).toBeCloseTo(boundaryAfter.x - boundaryBefore.x, 0);
  expect(childAfter.y - childBefore.y).toBeCloseTo(boundaryAfter.y - boundaryBefore.y, 0);
  await expect(page.getByTestId('graph-stage').locator('.workflow-boundary')).toHaveCount(1);
  await page.waitForTimeout(250);
  await page.getByTestId('graph-stage').locator('.workflow-boundary header').click();
  await expect(page.getByTestId('graph-stage').locator('.status-collapsed')).toHaveCount(1);
  await page.getByTestId('graph-stage').locator('.status-collapsed').click();
  await expect(page.getByTestId('graph-stage').locator('.workflow-boundary')).toHaveCount(1);
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(page.getByTestId('graph-stage').locator('.status-collapsed')).toHaveCount(1);
  const collapsedGeometry = await page.getByTestId('graph-stage').locator('.status-collapsed').evaluate((node) => {
    const tile = node.querySelector('.node-tile')!;
    return {
      nodeWidth: getComputedStyle(node).width,
      nodeHeight: getComputedStyle(node).height,
      tileWidth: getComputedStyle(tile).width,
      tileHeight: getComputedStyle(tile).height,
      label: node.querySelector('strong')?.textContent,
    };
  });
  expect(collapsedGeometry).toEqual({ nodeWidth: '100px', nodeHeight: '80px', tileWidth: '100px', tileHeight: '80px', label: 'Generate draft' });

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Content Operations');
  await expect(page.getByRole('button', { name: 'View', exact: true })).toHaveClass(/is-active/);
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(page.getByTestId('graph-stage').locator('.react-flow__minimap')).toHaveCount(0);
});

test('routes a backward loop around the node between its endpoints', async ({ page }) => {
  const loop = {
    id: 'routing-loop', name: 'Routing loop', nodes: [
      { id: 'a', name: 'First', type: 'n8n-nodes-base.code', position: [0, 0], parameters: {} },
      { id: 'b', name: 'Middle', type: 'n8n-nodes-base.code', position: [160, 0], parameters: {} },
      { id: 'c', name: 'Last', type: 'n8n-nodes-base.code', position: [320, 0], parameters: {} },
    ],
    connections: {
      First: { main: [[{ node: 'Middle', type: 'main', index: 0 }]] },
      Middle: { main: [[{ node: 'Last', type: 'main', index: 0 }]] },
      Last: { main: [[{ node: 'First', type: 'main', index: 0 }]] },
    },
  };
  await page.locator('input[type=file]').setInputFiles({ name: 'routing-loop.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(loop)) });
  await page.getByRole('button', { name: 'Close import results' }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByTestId('graph-stage').locator('.react-flow__edge-path[d]')).toHaveCount(3);

  const first = page.getByTestId('graph-stage').locator('.react-flow__node').filter({ hasText: 'First' });
  const middle = page.getByTestId('graph-stage').locator('.react-flow__node').filter({ hasText: 'Middle' });
  const firstBefore = await first.boundingBox();
  if (!firstBefore) throw new Error('First node geometry was unavailable.');
  await page.mouse.move(firstBefore.x + firstBefore.width / 2, firstBefore.y + firstBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstBefore.x + firstBefore.width / 2 + 60, firstBefore.y + firstBefore.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  const firstAfter = await first.boundingBox();
  expect(firstAfter?.x).not.toBeCloseTo(firstBefore.x, 0);
  await first.click();
  await page.keyboard.down('Control');
  await middle.click();
  await page.keyboard.up('Control');
  await expect(page.getByTestId('graph-stage').locator('.react-flow__node.selected')).toHaveCount(2);
  await page.getByRole('button', { name: 'Loops', exact: true }).click();
  await expect(page.getByTestId('graph-stage').locator('.is-loop-node')).toHaveCount(3);

  const crossesMiddle = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const byLabel = (label: string) => nodes.find((node) => node.querySelector('strong')?.textContent === label)!;
    const firstId = byLabel('First').getAttribute('data-id');
    const lastId = byLabel('Last').getAttribute('data-id');
    const middleRect = byLabel('Middle').querySelector('.node-tile')!.getBoundingClientRect();
    const route = [...document.querySelectorAll('[data-route-source]')].find((group) => group.getAttribute('data-route-source') === lastId && group.getAttribute('data-route-target') === firstId)!;
    const path = route.querySelector('.react-flow__edge-path') as SVGPathElement;
    const matrix = path.getScreenCTM()!;
    const length = path.getTotalLength();
    for (let step = 1; step < 100; step += 1) {
      const point = path.getPointAtLength((length * step) / 100);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      if (screen.x > middleRect.left && screen.x < middleRect.right && screen.y > middleRect.top && screen.y < middleRect.bottom) return true;
    }
    return false;
  });
  expect(crossesMiddle).toBe(false);
});

test('centers a four-input Merge icon and aligns its outgoing handle', async ({ page }) => {
  const alignedMerge = {
    id: 'aligned-merge', name: 'Aligned Merge', nodes: [
      { id: 'merge', name: 'Merge', type: 'n8n-nodes-base.merge', position: [0, 0], parameters: { numberInputs: 4 } },
      { id: 'next', name: 'Aggregate', type: 'n8n-nodes-base.aggregate', position: [144, 32], parameters: {} },
    ],
    connections: { Merge: { main: [[{ node: 'Aggregate', type: 'main', index: 0 }]] } },
  };
  await page.locator('input[type=file]').setInputFiles({ name: 'aligned-merge.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(alignedMerge)) });
  await page.getByRole('button', { name: 'Close import results' }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aligned Merge');
  await expect(page.getByTestId('graph-stage').locator('.canvas-node')).toHaveCount(2);
  await page.getByRole('button', { name: 'Reset view' }).click();

  const geometry = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const merge = nodes.find((node) => node.querySelector('strong')?.textContent === 'Merge')!;
    const aggregate = nodes.find((node) => node.querySelector('strong')?.textContent === 'Aggregate')!;
    const tile = merge.querySelector('.node-tile')!.getBoundingClientRect();
    const icon = merge.querySelector('.node-symbol')!.getBoundingClientRect();
    const output = merge.querySelector('[data-handleid="out:main:0"]')!.getBoundingClientRect();
    const input = aggregate.querySelector('[data-handleid="in:main:0"]')!.getBoundingClientRect();
    return {
      tileHeight: Number.parseFloat(getComputedStyle(merge.querySelector('.node-tile')!).height),
      iconOffsetX: (icon.left + icon.width / 2) - (tile.left + tile.width / 2),
      iconOffsetY: (icon.top + icon.height / 2) - (tile.top + tile.height / 2),
      handleOffsetY: (output.top + output.height / 2) - (input.top + input.height / 2),
    };
  });
  expect(geometry.tileHeight).toBeCloseTo(144, 1);
  expect(geometry.iconOffsetX).toBeCloseTo(0, 1);
  expect(geometry.iconOffsetY).toBeCloseTo(0, 1);
  expect(geometry.handleOffsetY).toBeCloseTo(0, 1);
});

test('aligns an IF true output with the exported successor position', async ({ page }) => {
  const alignedIf = {
    id: 'aligned-if', name: 'Aligned IF', nodes: [
      { id: 'if', name: 'Need work?', type: 'n8n-nodes-base.if', position: [0, 0], parameters: {} },
      { id: 'true', name: 'True branch', type: 'n8n-nodes-base.executeWorkflow', position: [144, -16], parameters: {} },
      { id: 'false', name: 'False branch', type: 'n8n-nodes-base.executeWorkflow', position: [144, 112], parameters: {} },
    ],
    connections: {
      'Need work?': { main: [
        [{ node: 'True branch', type: 'main', index: 0 }],
        [{ node: 'False branch', type: 'main', index: 0 }],
      ] },
    },
  };
  await page.locator('input[type=file]').setInputFiles({ name: 'aligned-if.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(alignedIf)) });
  await page.getByRole('button', { name: 'Close import results' }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aligned IF');
  await expect(page.getByTestId('graph-stage').locator('.canvas-node')).toHaveCount(3);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByTestId('graph-stage').locator('.react-flow__edge-path[d]')).toHaveCount(2);

  const truePath = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const byLabel = (label: string) => nodes.find((node) => node.querySelector('strong')?.textContent === label)!;
    const ifId = byLabel('Need work?').getAttribute('data-id');
    const trueId = byLabel('True branch').getAttribute('data-id');
    const route = [...document.querySelectorAll('[data-route-source]')].find((group) => (
      group.getAttribute('data-route-source') === ifId && group.getAttribute('data-route-target') === trueId
    ));
    return route?.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? '';
  });
  expect(truePath).not.toContain('Q');
  expect(truePath).not.toContain('C');

  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  const trueNode = page.getByTestId('graph-stage').locator('.react-flow__node').filter({ hasText: 'True branch' });
  const falseNode = page.getByTestId('graph-stage').locator('.react-flow__node').filter({ hasText: 'False branch' });
  await trueNode.click();
  await falseNode.click({ modifiers: ['Control'] });
  await expect(page.getByTestId('graph-stage').locator('.is-checkpoint')).toHaveCount(2);
  await expect(page.getByText('Some checkpoints conflict; one compatible branch will be chosen randomly.')).toBeVisible();
  await page.getByRole('button', { name: 'Branches', exact: true }).click();
  await expect(page.getByTestId('graph-stage').locator('.is-branch-node')).toHaveCount(1);
  await page.getByLabel('Speed').selectOption('250');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.getByTestId('graph-stage').locator('.is-simulation-active')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Simulate', exact: true })).toBeVisible({ timeout: 3000 });
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
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByTestId('graph-stage').locator('.sticky-note')).toContainText('Image blocked');
  expect(await page.evaluate(() => (window as typeof window & { __xss?: number }).__xss)).toBeUndefined();
  expect(externalRequests).toEqual([]);

  const png = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG' }).click();
  expect((await png).suggestedFilename()).toBe('safe-notes-view.png');
  const svg = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SVG' }).click();
  expect((await svg).suggestedFilename()).toBe('safe-notes-view.svg');
});
