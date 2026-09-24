import type { JsonRecord } from '../src/n8n/types';

export function node(
  name: string,
  id: string,
  position: [number, number],
  type = 'n8n-nodes-base.set',
  parameters: JsonRecord = {},
  extra: JsonRecord = {},
): JsonRecord {
  return { name, id, position, type, typeVersion: 1, parameters, ...extra };
}

export function workflow(id: string | undefined, name: string, nodes: JsonRecord[], connections: JsonRecord = {}): JsonRecord {
  return { ...(id ? { id } : {}), name, active: false, nodes, connections };
}

export function childWorkflow(id = 'child'): JsonRecord {
  return workflow(id, 'Synthetic Child', [
    node('When Executed', 'trigger', [0, 0], 'n8n-nodes-base.executeWorkflowTrigger', { inputSource: 'passthrough' }),
    node('Left branch', 'left', [260, -90]),
    node('Right branch', 'right', [260, 90]),
  ], {
    'When Executed': { main: [[
      { node: 'Left branch', type: 'main', index: 0 },
      { node: 'Right branch', type: 'main', index: 0 },
    ]] },
  });
}

export function mainWorkflow(childId = 'child'): JsonRecord {
  return workflow('main', 'Synthetic Main', [
    node('Start', 'start', [0, 0], 'n8n-nodes-base.manualTrigger'),
    node('Run Child', 'call', [280, 0], 'n8n-nodes-base.executeWorkflow', {
      source: 'database',
      workflowId: { __rl: true, mode: 'list', value: childId, cachedResultName: 'Synthetic Child' },
    }, { typeVersion: 1.3 }),
    node('Finish', 'finish', [560, 0]),
  ], {
    Start: { main: [[{ node: 'Run Child', type: 'main', index: 0 }]] },
    'Run Child': { main: [[{ node: 'Finish', type: 'main', index: 0 }]] },
  });
}
