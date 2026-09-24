import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { parseN8nDocument } from '../src/n8n/parser';
import { clearAllLocalData, destroyDatabaseForTests, loadUiState, loadWorkflows, removeWorkflow, replaceRawWorkflow, saveUiState, saveWorkflow } from '../src/storage/db';
import { node, workflow } from './fixtures';

afterEach(async () => {
  await destroyDatabaseForTests();
});

describe('IndexedDB storage', () => {
  it('restores raw data through the current parser and replaces duplicate IDs', async () => {
    const first = parseN8nDocument(workflow('same', 'First', [node('A', 'a', [0, 0])])).workflows[0];
    const second = parseN8nDocument(workflow('same', 'Second', [node('B', 'b', [10, 20])])).workflows[0];
    await saveWorkflow(first);
    await saveWorkflow(second);
    expect(await loadWorkflows()).toMatchObject([{ id: 'same', name: 'Second' }]);
    await replaceRawWorkflow('workflow:same', 'changed.json', workflow('same', 'Reparsed', [node('C', 'c', [0, 0])]));
    expect((await loadWorkflows())[0].name).toBe('Reparsed');
  });

  it('removes individual workflows and clears every object store', async () => {
    const first = parseN8nDocument(workflow('one', 'One', [node('A', 'a', [0, 0])])).workflows[0];
    const second = parseN8nDocument(workflow('two', 'Two', [node('B', 'b', [0, 0])])).workflows[0];
    await saveWorkflow(first); await saveWorkflow(second); await saveUiState('workspace', { selected: 'one' });
    await removeWorkflow('workflow:one');
    expect((await loadWorkflows()).map((item) => item.id)).toEqual(['two']);
    await clearAllLocalData();
    expect(await loadWorkflows()).toEqual([]);
    expect(await loadUiState('workspace')).toBeUndefined();
  });
});
