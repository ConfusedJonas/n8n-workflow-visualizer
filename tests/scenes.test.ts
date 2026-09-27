import { describe, expect, it } from 'vitest';
import { parseN8nDocument } from '../src/n8n/parser';
import { buildDependencyScene } from '../src/renderers/dependencies/dependency';
import { buildExpandedScene } from '../src/renderers/expanded/expanded';
import { shiftForExpansion } from '../src/renderers/expanded/layout';
import { buildOriginalScene } from '../src/renderers/workflow/original';
import { createWorkspace } from '../src/workspace/resolve';
import { childWorkflow, mainWorkflow, node, workflow } from './fixtures';

const parse = (raw: ReturnType<typeof workflow>) => parseN8nDocument(raw).workflows[0];

describe('scene builders', () => {
  it('preserves original coordinates and arbitrary handle indices', () => {
    const raw = workflow('original', 'Original', [node('A', 'a', [-100, 25]), node('B', 'b', [480, 90])], {
      A: { future: [null, [{ node: 'B', type: 'futureTarget', index: 4 }]] },
    });
    const scene = buildOriginalScene(parse(raw));
    expect(scene.nodes.find((item) => item.id.endsWith('node:a'))).toMatchObject({ x: -100, y: 25, width: 100, height: 80 });
    expect(scene.edges[0]).toMatchObject({ sourceHandle: 'out:future:1', targetHandle: 'in:futureTarget:4' });
  });

  it('expands multi-input node geometry without changing exported coordinates', () => {
    const merge = node('Merge', 'merge', [320, 40], 'n8n-nodes-base.merge', { numberInputs: 4 });
    const raw = workflow('multi-input', 'Multi input', [
      node('One', 'one', [0, 0]), node('Two', 'two', [0, 120]), node('Three', 'three', [0, 240]), node('Four', 'four', [0, 360]), merge,
    ], {
      One: { main: [[{ node: 'Merge', type: 'main', index: 0 }]] },
      Two: { main: [[{ node: 'Merge', type: 'main', index: 1 }]] },
      Three: { main: [[{ node: 'Merge', type: 'main', index: 2 }]] },
      Four: { main: [[{ node: 'Merge', type: 'main', index: 3 }]] },
    });
    const mergeNode = buildOriginalScene(parse(raw)).nodes.find((item) => item.id.endsWith('node:merge'));
    expect(mergeNode).toMatchObject({ x: 320, y: 40, width: 100, height: 144, data: { inputCount: 4 } });
  });

  it('deduplicates dependency edges with counts and lays out deterministically', () => {
    const main = mainWorkflow();
    (main.nodes as Record<string, unknown>[]).push(node('Run Child Again', 'call2', [280, 160], 'n8n-nodes-base.executeWorkflow', { workflowId: 'child' }));
    const workspace = createWorkspace([parse(main), parse(childWorkflow())]);
    const first = buildDependencyScene(workspace, 'workflow:main');
    const second = buildDependencyScene(workspace, 'workflow:main');
    expect(first).toEqual(second);
    expect(first.edges).toHaveLength(1);
    expect(first.edges[0].label).toBe('×2');
  });

  it('expands at the call position, hides one enabled trigger, and keeps trigger fan-out', () => {
    const workspace = createWorkspace([parse(mainWorkflow()), parse(childWorkflow())]);
    const scene = buildExpandedScene(workspace, 'workflow:main');
    expect(scene.nodes.some((item) => item.kind === 'boundary' && item.x === 280)).toBe(true);
    expect(scene.nodes.some((item) => item.id.includes('/node:trigger'))).toBe(false);
    const entries = scene.nodes.filter((item) => item.data.boundaryEntry);
    expect(entries.map((item) => item.data.label).sort()).toEqual(['Left branch', 'Right branch']);
    expect(scene.nodes.some((item) => item.kind === 'port' && !item.data.simulationOnly)).toBe(false);
    expect(scene.edges.filter((edge) => edge.hidden && entries.some((entry) => edge.target === entry.id))).toHaveLength(2);
    const boundary = scene.nodes.find((item) => item.kind === 'boundary')!;
    expect(scene.edges.some((edge) => !edge.hidden && edge.target === boundary.id)).toBe(true);
    const exitSync = scene.nodes.find((item) => item.data.simulationOnly)!;
    expect(exitSync).toMatchObject({ kind: 'port', width: 0, height: 0 });
    expect(scene.edges.filter((edge) => edge.hidden && edge.target === exitSync.id)).toHaveLength(2);
    expect(scene.edges.filter((edge) => edge.hidden && edge.source === exitSync.id)).toHaveLength(1);
  });

  it('marks every possible terminal without adding result ports', () => {
    const branchedWorkspace = createWorkspace([parse(mainWorkflow()), parse(childWorkflow())]);
    const branched = buildExpandedScene(branchedWorkspace, 'workflow:main');
    expect(branched.nodes.filter((item) => item.data.boundaryExit)).toHaveLength(2);
    expect(branched.nodes.some((item) => item.id.includes('/result'))).toBe(false);

    const singleChild = workflow('single', 'Single child', [
      node('Input', 'trigger', [0, 0], 'n8n-nodes-base.executeWorkflowTrigger'), node('Only', 'only', [240, 0]),
    ], { Input: { main: [[{ node: 'Only', type: 'main', index: 0 }]] } });
    const workspace = createWorkspace([parse(mainWorkflow('single')), parse(singleChild)]);
    const expanded = buildExpandedScene(workspace, 'workflow:main');
    expect(expanded.nodes.some((item) => item.id.includes('workflow:main/call/result'))).toBe(false);
  });

  it('marks possible starts and records a boundary warning for absent or ambiguous triggers', () => {
    const noTrigger = workflow('no-trigger', 'No trigger', [node('A', 'a', [0, 0])]);
    const scene = buildExpandedScene(createWorkspace([parse(mainWorkflow('no-trigger')), parse(noTrigger)]), 'workflow:main');
    expect(scene.nodes.some((item) => item.data.label === 'A' && item.data.boundaryEntry)).toBe(true);
    expect(scene.nodes.find((item) => item.kind === 'boundary')?.data.entryWarning).toBeTruthy();
  });

  it('renders disabled, missing, collapsed, and recursive calls as distinct placeholders', () => {
    const disabled = mainWorkflow('child');
    (disabled.nodes as Record<string, unknown>[])[1].disabled = true;
    const disabledScene = buildExpandedScene(createWorkspace([parse(disabled), parse(childWorkflow())]), 'workflow:main');
    expect(disabledScene.nodes.find((item) => item.id.endsWith('/node:call'))?.kind).toBe('workflow');

    const missing = buildExpandedScene(createWorkspace([parse(mainWorkflow('missing'))]), 'workflow:main');
    expect(missing.nodes.find((item) => item.id.endsWith('/node:call'))).toMatchObject({
      kind: 'placeholder', width: 100, height: 80,
      data: { label: 'Run Child', nodeType: 'n8n-nodes-base.executeWorkflow', status: 'missing' },
    });

    const collapsed = buildExpandedScene(createWorkspace([parse(mainWorkflow()), parse(childWorkflow())]), 'workflow:main', { collapseAll: true });
    expect(collapsed.nodes.find((item) => item.data.status === 'collapsed')).toMatchObject({ width: 100, height: 80, data: { label: 'Run Child' } });

    const a = { ...mainWorkflow('b'), id: 'a', name: 'A' };
    const b = { ...mainWorkflow('a'), id: 'b', name: 'B' };
    const recursive = buildExpandedScene(createWorkspace([parse(a), parse(b)]), 'workflow:a');
    expect(recursive.nodes.find((item) => item.data.status === 'recursive')).toBeDefined();
  });

  it('shifts descendants and collisions right while preserving y and cumulative geometry', () => {
    const nodes = [
      { id: 'call', kind: 'workflow' as const, x: 100, y: 100, width: 190, height: 76, data: {} },
      { id: 'after', kind: 'workflow' as const, x: 350, y: 100, width: 190, height: 76, data: {} },
      { id: 'above', kind: 'workflow' as const, x: 0, y: -400, width: 190, height: 76, data: {} },
    ];
    const once = shiftForExpansion(nodes, 'call', 500, 300);
    const twice = shiftForExpansion(once.nodes, 'call', 650, 300);
    expect(once.nodes.find((item) => item.id === 'after')).toMatchObject({ x: 880, y: 100 });
    expect(once.nodes.find((item) => item.id === 'above')).toMatchObject({ x: 0, y: -400 });
    expect(twice.nodes.find((item) => item.id === 'after')!.x).toBeGreaterThan(once.nodes.find((item) => item.id === 'after')!.x);
  });

  it('preserves child-relative geometry inside expanded boundaries', () => {
    const scene = buildExpandedScene(createWorkspace([parse(mainWorkflow()), parse(childWorkflow())]), 'workflow:main');
    const left = scene.nodes.find((item) => item.id.endsWith('/node:left'))!;
    const right = scene.nodes.find((item) => item.id.endsWith('/node:right'))!;
    expect(right.x - left.x).toBe(0);
    expect(right.y - left.y).toBe(180);
  });
});
