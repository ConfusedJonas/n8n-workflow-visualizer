import dagre from '@dagrejs/dagre';
import type { Workspace } from '../../n8n/types';
import { familyForWorkflow } from '../../workspace/resolve';
import type { GraphScene, SceneEdge, SceneNode } from '../scene';
import { edgeStyle } from '../scene';

const WIDTH = 240;
const HEIGHT = 90;

export function buildDependencyScene(workspace: Workspace, selectedWorkflowKey: string): GraphScene {
  const family = familyForWorkflow(workspace, selectedWorkflowKey);
  const workflowKeys = family?.workflowKeys ?? [selectedWorkflowKey];
  const nodes = new Map<string, SceneNode>();
  const groupedEdges = new Map<string, { source: string; target: string; count: number; inactive: boolean }>();

  for (const key of workflowKeys) {
    const workflow = workspace.workflows[key];
    if (!workflow) continue;
    nodes.set(key, {
      id: key,
      kind: 'dependency',
      x: 0,
      y: 0,
      width: WIDTH,
      height: HEIGHT,
      data: {
        label: workflow.name,
        nodeCount: workflow.nodes.length,
        missingCount: workflow.subworkflowReferences.filter((ref) => ref.resolution === 'missing').length,
        embedded: workflow.origin === 'embedded',
        selected: key === selectedWorkflowKey,
      },
    });
    for (const reference of workflow.subworkflowReferences) {
      let target = reference.targetWorkflowKey;
      if (!target && reference.targetWorkflowId) target = `missing:${reference.targetWorkflowId}`;
      if (!target && reference.resolution === 'dynamic') target = `dynamic:${reference.id}`;
      if (!target && reference.resolution === 'external') target = `external:${reference.id}`;
      if (!target) continue;
      if (!nodes.has(target)) {
        const targetWorkflow = workspace.workflows[target];
        nodes.set(target, {
          id: target,
          kind: targetWorkflow ? 'dependency' : 'placeholder',
          x: 0,
          y: 0,
          width: WIDTH,
          height: HEIGHT,
          data: {
            label: targetWorkflow?.name ?? reference.targetLabel ?? reference.targetWorkflowId ?? 'Dynamic target',
            nodeCount: targetWorkflow?.nodes.length,
            status: targetWorkflow ? undefined : reference.resolution,
          },
        });
      }
      const pair = `${key}->${target}:${reference.disabled ? 'inactive' : 'active'}`;
      const existing = groupedEdges.get(pair);
      groupedEdges.set(pair, {
        source: key,
        target,
        count: (existing?.count ?? 0) + 1,
        inactive: reference.disabled,
      });
    }
  }

  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 110, marginx: 40, marginy: 40 });
  for (const node of nodes.values()) graph.setNode(node.id, { width: node.width, height: node.height });
  for (const edge of groupedEdges.values()) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);
  for (const node of nodes.values()) {
    const position = graph.node(node.id) as { x: number; y: number } | undefined;
    if (position) {
      node.x = position.x - node.width / 2;
      node.y = position.y - node.height / 2;
    }
  }

  const edges: SceneEdge[] = [...groupedEdges.entries()].map(([id, edge]) => ({
    id: `dependency:${id}`,
    source: edge.source,
    target: edge.target,
    connectionType: 'main',
    outputIndex: 0,
    inputIndex: 0,
    label: edge.count > 1 ? `×${edge.count}` : edge.inactive ? 'disabled' : undefined,
    inactive: edge.inactive,
    style: edgeStyle('main', edge.inactive),
  }));
  return { nodes: [...nodes.values()], edges };
}
