import { describe, expect, it } from 'vitest';
import { parseN8nDocument } from '../src/n8n/parser';
import { createWorkspace, descendantWorkflowKeys, getMissingReferences } from '../src/workspace/resolve';
import { childWorkflow, mainWorkflow, node, workflow } from './fixtures';

const parse = (...raw: ReturnType<typeof workflow>[]) => raw.flatMap((item) => parseN8nDocument(item).workflows);

describe('workspace resolution', () => {
  it('resolves by canonical ID and preserves missing targets', () => {
    const workspace = createWorkspace(parse(mainWorkflow(), childWorkflow()));
    const reference = workspace.workflows['workflow:main'].subworkflowReferences[0];
    expect(reference).toMatchObject({ resolution: 'resolved', targetWorkflowKey: 'workflow:child' });
    expect(workspace.families).toHaveLength(1);
    expect(workspace.families[0].roots).toEqual(['workflow:main']);
    expect(getMissingReferences(workspace)).toHaveLength(0);

    const missing = createWorkspace(parse(mainWorkflow('not-imported')));
    expect(getMissingReferences(missing)).toHaveLength(1);
    expect(missing.families[0].missingTargetIds).toEqual(['not-imported']);
    expect(missing.families[0].missingReferenceCount).toBe(1);
  });

  it('uses deterministic last-record replacement and shared children', () => {
    const first = parseN8nDocument(workflow('same', 'First', [node('A', 'a', [0, 0])])).workflows[0];
    const last = parseN8nDocument(workflow('same', 'Last', [node('B', 'b', [0, 0])])).workflows[0];
    const parent2 = parseN8nDocument({ ...mainWorkflow('same'), id: 'main2', name: 'Second parent' }).workflows[0];
    const workspace = createWorkspace([first, last, parseN8nDocument(mainWorkflow('same')).workflows[0], parent2]);
    expect(workspace.workflows['workflow:same'].name).toBe('Last');
    expect(workspace.families).toHaveLength(1);
    expect(workspace.workflows['workflow:main'].subworkflowReferences[0].targetWorkflowKey).toBe('workflow:same');
    expect(workspace.workflows['workflow:main2'].subworkflowReferences[0].targetWorkflowKey).toBe('workflow:same');
  });

  it('includes embedded targets and detects cycles without infinite traversal', () => {
    const embedded = workflow('inner', 'Inner', [node('Inside', 'inside', [0, 0])]);
    const parent = workflow('parent', 'Parent', [node('Embedded call', 'call', [0, 0], 'n8n-nodes-base.executeWorkflow', { source: 'parameter', workflowJson: embedded })]);
    const embeddedWorkspace = createWorkspace(parse(parent));
    expect(Object.keys(embeddedWorkspace.workflows)).toContain('embedded:workflow:parent:call');

    const a = { ...mainWorkflow('b'), id: 'a', name: 'A' };
    const b = { ...mainWorkflow('a'), id: 'b', name: 'B' };
    const cycle = createWorkspace(parse(a, b));
    const cycleFamily = cycle.families.find((family) => family.workflowKeys.includes('workflow:a'))!;
    expect(cycleFamily.cyclic).toBe(true);
    expect(descendantWorkflowKeys(cycle, 'workflow:a')).toEqual(new Set(['workflow:a', 'workflow:b']));
  });

  it('reports cycles even when a component also has a root', () => {
    const root = { ...mainWorkflow('a'), id: 'root', name: 'Root' };
    const a = { ...mainWorkflow('b'), id: 'a', name: 'A' };
    const b = { ...mainWorkflow('a'), id: 'b', name: 'B' };
    const workspace = createWorkspace(parse(root, a, b));
    expect(workspace.families[0].roots).toEqual(['workflow:root']);
    expect(workspace.families[0].cyclic).toBe(true);
  });
});
