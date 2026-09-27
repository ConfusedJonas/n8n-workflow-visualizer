import { describe, expect, it } from 'vitest';
import { parseN8nDocument, parseN8nJson } from '../src/n8n/parser';
import { node, workflow } from './fixtures';

describe('parseN8nDocument', () => {
  it('accepts single exports, arrays, and data wrappers', () => {
    const item = workflow('one', 'One', [node('A', 'a', [10, 20])]);
    expect(parseN8nDocument(item).workflows).toHaveLength(1);
    expect(parseN8nDocument([item, { ...item, id: 'two' }]).workflows).toHaveLength(2);
    expect(parseN8nDocument({ data: item }).workflows[0].id).toBe('one');
    expect(parseN8nDocument({ data: [item] }).workflows).toHaveLength(1);
  });

  it('creates stable identities and node fallbacks without moving valid positions', () => {
    const raw = workflow(undefined, 'No ID', [
      node('Placed', 'placed', [-120, 44]),
      { name: 'Fallback', type: 'vendor.futureNode', parameters: {} },
    ]);
    const first = parseN8nDocument(raw).workflows[0];
    const second = parseN8nDocument(raw).workflows[0];
    expect(first.key).toBe(second.key);
    expect(first.nodes[0].position).toEqual({ x: -120, y: 44 });
    expect(first.nodes[1].id).toMatch(/^generated-/);
    expect(first.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(['workflow.id.generated', 'node.id.generated', 'node.position.fallback']));
  });

  it('preserves sparse multi-output, multi-input, AI, and unknown connection types', () => {
    const parsed = parseN8nDocument(workflow('edges', 'Edges', [
      node('Source', 'source', [0, 0]), node('Target', 'target', [300, 0]),
    ], {
      Source: {
        main: [null, [{ node: 'Target', type: 'main', index: 3 }]],
        ai_languageModel: [[{ node: 'Target', type: 'ai_languageModel', index: 0 }]],
        ai_tool: [[{ node: 'Target', type: 'ai_tool', index: 1 }]],
        ai_memory: [[{ node: 'Target', type: 'ai_memory', index: 0 }]],
        future_socket: [[{ node: 'Target', type: 'future_input', index: 7 }]],
      },
    })).workflows[0];
    expect(parsed.edges.map((edge) => [edge.connectionType, edge.outputIndex, edge.targetConnectionType, edge.inputIndex])).toEqual([
      ['main', 1, 'main', 3],
      ['ai_languageModel', 0, 'ai_languageModel', 0],
      ['ai_tool', 0, 'ai_tool', 1],
      ['ai_memory', 0, 'ai_memory', 0],
      ['future_socket', 0, 'future_input', 7],
    ]);
  });

  it.each([
    ['legacy string', { workflowId: 'legacy-id' }, 'legacy-id'],
    ['resource locator', { workflowId: { value: 'current-id', cachedResultName: 'Cached only' } }, 'current-id'],
    ['omitted source default', { workflowId: 'default-id' }, 'default-id'],
  ])('extracts database workflow IDs from %s', (_label, parameters, expected) => {
    const parsed = parseN8nDocument(workflow('caller', 'Caller', [node('Call', 'call', [0, 0], 'n8n-nodes-base.executeWorkflow', parameters)])).workflows[0];
    expect(parsed.subworkflowReferences[0]).toMatchObject({ sourceMode: 'database', resolution: 'missing', targetWorkflowId: expected });
  });

  it('never guesses dynamic and unresolved database values', () => {
    for (const value of ['={{ $json.workflowId }}', '${undefined}', 'undefined']) {
      const parsed = parseN8nDocument(workflow('caller', 'Caller', [node('Call', value, [0, 0], 'n8n-nodes-base.executeWorkflow', { workflowId: { value } })])).workflows[0];
      expect(parsed.subworkflowReferences[0].resolution).toBe('dynamic');
      expect(parsed.subworkflowReferences[0].targetWorkflowId).toBeUndefined();
    }
  });

  it('supports embedded parameter workflows and expression-based parameter mode', () => {
    const embedded = workflow('embedded-export-id', 'Embedded', [node('Inside', 'inside', [0, 0])]);
    const literal = parseN8nDocument(workflow('caller', 'Caller', [node('Call', 'literal', [0, 0], 'n8n-nodes-base.executeWorkflow', { source: 'parameter', workflowJson: JSON.stringify(embedded) })])).workflows[0].subworkflowReferences[0];
    expect(literal.resolution).toBe('embedded');
    expect(literal.embeddedWorkflow?.name).toBe('Embedded');
    expect(literal.targetWorkflowKey).toMatch(/^embedded:/);
    const dynamic = parseN8nDocument(workflow('caller', 'Caller', [node('Call', 'dynamic', [0, 0], 'n8n-nodes-base.executeWorkflow', { source: 'parameter', workflowJson: '={{ $json.definition }}' })])).workflows[0].subworkflowReferences[0];
    expect(dynamic.resolution).toBe('dynamic');
  });

  it.each([
    ['localFile', 'workflowPath', '/tmp/workflow.json'],
    ['url', 'workflowUrl', 'https://example.invalid/workflow.json'],
  ])('marks %s references as external without opening them', (source, parameter, value) => {
    const parsed = parseN8nDocument(workflow('caller', 'Caller', [node('Call', 'call', [0, 0], 'n8n-nodes-base.executeWorkflow', { source, [parameter]: value })])).workflows[0];
    expect(parsed.subworkflowReferences[0]).toMatchObject({ sourceMode: source, resolution: 'external', targetLabel: value });
  });

  it('retains sticky notes separately and applies documented defaults', () => {
    const parsed = parseN8nDocument(workflow('sticky', 'Sticky', [
      node('Note', 'note', [13, 17], 'n8n-nodes-base.stickyNote', { content: '# Safe', color: 4 }),
      node('Custom Note', 'custom-note', [300, 17], 'n8n-nodes-base.stickyNote', { color: '#A25100' }),
    ])).workflows[0];
    expect(parsed.nodes).toHaveLength(0);
    expect(parsed.stickyNotes[0]).toMatchObject({ width: 240, height: 160, color: 4, content: '# Safe' });
    expect(parsed.stickyNotes[1].color).toBe('#A25100');
  });

  it.each(['workflowInputs', 'jsonExample', 'passthrough'])('preserves Execute Workflow Trigger input mode %s', (inputSource) => {
    const parsed = parseN8nDocument(workflow('trigger', 'Trigger', [
      node('Input', 'input', [0, 0], 'n8n-nodes-base.executeWorkflowTrigger', { inputSource }),
    ])).workflows[0];
    expect(parsed.nodes[0].parameters.inputSource).toBe(inputSource);
  });

  it('marks unknown and incomplete source modes invalid', () => {
    const parsed = parseN8nDocument(workflow('invalid-sources', 'Invalid', [
      node('Unknown', 'unknown', [0, 0], 'n8n-nodes-base.executeWorkflow', { source: 'futureSource', token: 1 }),
      node('Empty file', 'empty-file', [200, 0], 'n8n-nodes-base.executeWorkflow', { source: 'localFile' }),
    ])).workflows[0];
    expect(parsed.subworkflowReferences.map((reference) => [reference.sourceMode, reference.resolution])).toEqual([
      ['unknown', 'invalid'], ['localFile', 'invalid'],
    ]);
  });

  it('keeps disabled nodes and disabled call dependencies', () => {
    const parsed = parseN8nDocument(workflow('disabled', 'Disabled', [
      node('Call', 'call', [0, 0], 'n8n-nodes-base.executeWorkflow', { workflowId: 'child' }, { disabled: true }),
    ])).workflows[0];
    expect(parsed.nodes[0].disabled).toBe(true);
    expect(parsed.subworkflowReferences[0].disabled).toBe(true);
  });

  it('keeps valid portions and diagnoses malformed nodes and connections', () => {
    const parsed = parseN8nDocument({
      id: 'malformed', name: 'Malformed', nodes: [null, node('A', 'a', [0, 0])],
      connections: { Missing: { main: [[{ node: 'A', type: 'main', index: 0 }, {}]] }, A: { main: 'bad' } },
    });
    expect(parsed.workflows[0].nodes).toHaveLength(1);
    expect(parsed.workflows[0].edges[0]).toMatchObject({ valid: false, sourceName: 'Missing', targetName: 'A' });
    expect(parsed.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(['node.invalid', 'connection.dangling', 'connection.invalid', 'connections.type.invalid']));
  });

  it('reports invalid JSON and unsupported shapes', () => {
    expect(parseN8nJson('{oops').diagnostics[0].code).toBe('json.invalid');
    expect(parseN8nDocument({ hello: 'world' }).workflows).toHaveLength(0);
    expect(parseN8nDocument({ hello: 'world' }).diagnostics[0].severity).toBe('error');
  });
});
