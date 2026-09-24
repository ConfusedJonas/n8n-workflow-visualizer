import type { NormalizedWorkflow } from '../../n8n/types';
import type { GraphScene, SceneEdge, SceneNode } from '../scene';
import { edgeStyle, makeHandle } from '../scene';

// n8n positions nodes by a compact canvas footprint. Keeping the footprint
// separate from the inner tile preserves the exported coordinates and leaves
// room for the label without making neighbouring nodes collide.
export const DEFAULT_NODE_WIDTH = 100;
export const DEFAULT_NODE_HEIGHT = 100;

export function buildOriginalScene(workflow: NormalizedWorkflow, prefix = workflow.key): GraphScene {
  const nodeId = (id: string) => `${prefix}/node:${id}`;
  const nodes: SceneNode[] = workflow.nodes.map((node) => ({
    id: nodeId(node.id),
    kind: 'workflow',
    x: node.position.x,
    y: node.position.y,
    width: DEFAULT_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT,
    data: {
      nodeId: node.id,
      label: node.name,
      nodeType: node.type,
      typeVersion: node.typeVersion,
      disabled: node.disabled,
      resource: typeof node.parameters.resource === 'string' ? node.parameters.resource : undefined,
      operation: typeof node.parameters.operation === 'string' ? node.parameters.operation : undefined,
    },
  }));
  nodes.push(
    ...workflow.stickyNotes.map<SceneNode>((note) => ({
      id: `${prefix}/sticky:${note.id}`,
      kind: 'sticky',
      x: note.position.x,
      y: note.position.y,
      width: note.width,
      height: note.height,
      zIndex: -2,
      data: { label: note.name, content: note.content, color: note.color },
    })),
  );

  const edges = workflow.edges
    .filter((edge) => edge.valid && edge.sourceNodeId && edge.targetNodeId)
    .map<SceneEdge>((edge) => ({
      id: `${prefix}/${edge.id}`,
      source: nodeId(edge.sourceNodeId!),
      target: nodeId(edge.targetNodeId!),
      sourceHandle: makeHandle('out', edge.connectionType, edge.outputIndex),
      targetHandle: makeHandle('in', edge.targetConnectionType, edge.inputIndex),
      connectionType: edge.connectionType,
      outputIndex: edge.outputIndex,
      inputIndex: edge.inputIndex,
      style: edgeStyle(edge.connectionType),
    }));
  return { nodes, edges };
}
