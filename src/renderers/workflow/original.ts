import type { NormalizedWorkflow } from '../../n8n/types';
import type { GraphScene, SceneEdge, SceneNode } from '../scene';
import { edgeStyle, makeHandle } from '../scene';

// n8n positions nodes by a compact canvas footprint. Keeping the footprint
// separate from the inner tile preserves the exported coordinates and leaves
// room for the label without making neighbouring nodes collide.
export const DEFAULT_NODE_WIDTH = 100;
export const DEFAULT_NODE_HEIGHT = 100;

function connectedSlotCount(workflow: NormalizedWorkflow, nodeId: string, direction: 'input' | 'output'): number {
  const indices = workflow.edges
    .filter((edge) => edge.valid && edge.connectionType === 'main' && (direction === 'input' ? edge.targetNodeId === nodeId : edge.sourceNodeId === nodeId))
    .map((edge) => direction === 'input' ? edge.inputIndex : edge.outputIndex);
  return indices.length ? Math.max(...indices) + 1 : 0;
}

function numericParameter(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}

function nodeDetail(workflow: NormalizedWorkflow, nodeId: string, nodeType: string, parameters: Record<string, unknown>): string | undefined {
  const normalized = nodeType.toLowerCase();
  if (normalized.includes('executeworkflow')) {
    const reference = workflow.subworkflowReferences.find((candidate) => candidate.nodeId === nodeId);
    const target = reference?.targetWorkflowId ?? (reference?.resolution === 'dynamic' ? 'dynamic' : undefined);
    return target ? `Workflow: ${target}` : undefined;
  }
  if (normalized.endsWith('.merge')) return typeof parameters.mode === 'string' ? parameters.mode : 'append';
  if (normalized.endsWith('.set')) return typeof parameters.mode === 'string' ? parameters.mode : 'manual';
  const parts = [parameters.resource, parameters.operation].filter((value): value is string => typeof value === 'string');
  return parts.length ? parts.join(' · ') : undefined;
}

export function buildOriginalScene(workflow: NormalizedWorkflow, prefix = workflow.key): GraphScene {
  const nodeId = (id: string) => `${prefix}/node:${id}`;
  const nodes: SceneNode[] = workflow.nodes.map((node) => {
    const normalizedType = node.type.toLowerCase();
    const declaredInputs = numericParameter(node.parameters.numberInputs) ?? 0;
    const inputCount = Math.max(connectedSlotCount(workflow, node.id, 'input'), declaredInputs);
    const outputCount = Math.max(connectedSlotCount(workflow, node.id, 'output'), normalizedType.endsWith('.if') ? 2 : 0);
    const visibleSlotCount = Math.max(inputCount, outputCount);
    const height = visibleSlotCount > 2 ? DEFAULT_NODE_HEIGHT + ((visibleSlotCount - 1) * 40) : DEFAULT_NODE_HEIGHT;
    return {
      id: nodeId(node.id),
      kind: 'workflow',
      x: node.position.x,
      y: node.position.y,
      width: DEFAULT_NODE_WIDTH,
      height,
      data: {
        nodeId: node.id,
        label: node.name,
        nodeType: node.type,
        typeVersion: node.typeVersion,
        disabled: node.disabled,
        inputCount,
        outputCount,
        detail: nodeDetail(workflow, node.id, node.type, node.parameters),
      },
    };
  });
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
