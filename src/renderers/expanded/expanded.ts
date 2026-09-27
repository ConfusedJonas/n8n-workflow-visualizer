import { isWorkflowInputTrigger } from '../../n8n/parser';
import type { NormalizedWorkflow, SubworkflowReference, Workspace } from '../../n8n/types';
import type { GraphScene, SceneNode } from '../scene';
import { sceneBounds } from '../scene';
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH, buildOriginalScene } from '../workflow/original';
import { shiftForExpansion } from './layout';

interface Fragment extends GraphScene {
  entryIds: string[];
  terminalIds: string[];
  ambiguousEntry: boolean;
  ambiguousExit: boolean;
}

export interface ExpandedOptions {
  collapsedPaths?: Set<string>;
  collapseAll?: boolean;
}

function prefixForPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9:_/-]/g, '_');
}

function placeholderData(reference: SubworkflowReference, status: string = reference.resolution) {
  return {
    targetLabel: reference.targetLabel ?? reference.targetWorkflowId ?? reference.nodeName,
    status,
    targetId: reference.targetWorkflowId,
  };
}

function replaceWithPlaceholder(scene: GraphScene, nodeId: string, data: Record<string, unknown>): string {
  const node = scene.nodes.find((item) => item.id === nodeId);
  if (!node) return nodeId;
  node.kind = 'placeholder';
  // A collapsed or unresolved call retains the exact geometry and appearance
  // of its Execute Workflow node. Status is presentation metadata, not a new
  // graph shape that should disturb exported coordinates or edge alignment.
  node.data = { ...node.data, ...data };
  return node.id;
}

function translateScene(scene: GraphScene, x: number, y: number): GraphScene {
  return {
    nodes: scene.nodes.map((node) => ({ ...node, x: node.x + x, y: node.y + y })),
    edges: scene.edges.map((edge) => ({ ...edge })),
  };
}

function terminalIds(scene: GraphScene): string[] {
  const mainEdges = scene.edges.filter((edge) => edge.connectionType === 'main');
  const mainParticipants = new Set(mainEdges.flatMap((edge) => [edge.source, edge.target]));
  const connected = new Set(scene.edges.flatMap((edge) => [edge.source, edge.target]));
  const candidates = scene.nodes.filter((node) => ['workflow', 'placeholder'].includes(node.kind)
    && (mainParticipants.has(node.id) || !connected.has(node.id)));
  const sources = new Set(mainEdges.map((edge) => edge.source));
  return candidates.filter((node) => !sources.has(node.id)).map((node) => node.id);
}

function hideInputTrigger(fragment: Fragment, workflow: NormalizedWorkflow, prefix: string): Fragment {
  const triggers = workflow.nodes.filter((node) => isWorkflowInputTrigger(node) && !node.disabled);
  if (triggers.length !== 1) {
    const mainEdges = fragment.edges.filter((edge) => edge.connectionType === 'main');
    const incoming = new Set(mainEdges.map((edge) => edge.target));
    const mainParticipants = new Set(mainEdges.flatMap((edge) => [edge.source, edge.target]));
    const connected = new Set(fragment.edges.flatMap((edge) => [edge.source, edge.target]));
    const entryIds = fragment.nodes
      .filter((node) => ['workflow', 'placeholder'].includes(node.kind)
        && !incoming.has(node.id)
        && (mainParticipants.has(node.id) || !connected.has(node.id)))
      .map((node) => node.id);
    fragment.nodes = fragment.nodes.map((node) => entryIds.includes(node.id)
      ? { ...node, data: { ...node.data, boundaryEntry: true } }
      : node);
    return { ...fragment, entryIds, ambiguousEntry: true };
  }

  const triggerId = `${prefix}/node:${triggers[0].id}`;
  if (!fragment.nodes.some((node) => node.id === triggerId)) return fragment;
  fragment.nodes = fragment.nodes.filter((node) => node.id !== triggerId);
  const outgoing = fragment.edges.filter((edge) => edge.source === triggerId);
  fragment.edges = fragment.edges.filter((edge) => edge.source !== triggerId && edge.target !== triggerId);
  const entryIds = [...new Set(outgoing.map((edge) => edge.target))];
  fragment.nodes = fragment.nodes.map((node) => entryIds.includes(node.id)
    ? { ...node, data: { ...node.data, boundaryEntry: true } }
    : node);
  return { ...fragment, entryIds, ambiguousEntry: false };
}

function addExit(fragment: Fragment): Fragment {
  const terminals = terminalIds(fragment);
  fragment.nodes = fragment.nodes.map((node) => terminals.includes(node.id)
    ? { ...node, data: { ...node.data, boundaryExit: true } }
    : node);
  return { ...fragment, terminalIds: terminals, ambiguousExit: terminals.length !== 1 };
}

function buildFragment(
  workspace: Workspace,
  workflowKey: string,
  path: string,
  ancestors: Set<string>,
  options: ExpandedOptions,
  hideTrigger: boolean,
  depth: number,
): Fragment {
  const workflow = workspace.workflows[workflowKey];
  if (!workflow) return { nodes: [], edges: [], entryIds: [], terminalIds: [], ambiguousEntry: true, ambiguousExit: true };
  const prefix = prefixForPath(path);
  let scene = buildOriginalScene(workflow, prefix);
  const references = [...workflow.subworkflowReferences].sort((a, b) => {
    const aNode = workflow.nodes.find((node) => node.id === a.nodeId);
    const bNode = workflow.nodes.find((node) => node.id === b.nodeId);
    return (aNode?.position.x ?? 0) - (bNode?.position.x ?? 0) || (aNode?.position.y ?? 0) - (bNode?.position.y ?? 0) || a.nodeId.localeCompare(b.nodeId);
  });

  for (const reference of references) {
    const callId = `${prefix}/node:${reference.nodeId}`;
    const callNode = scene.nodes.find((node) => node.id === callId);
    if (!callNode || reference.disabled) continue;
    const instancePath = `${path}/${reference.nodeId}`;
    const targetKey = reference.targetWorkflowKey;

    if (!targetKey || !workspace.workflows[targetKey]) {
      replaceWithPlaceholder(scene, callId, placeholderData(reference));
      continue;
    }
    if (ancestors.has(targetKey)) {
      replaceWithPlaceholder(scene, callId, placeholderData(reference, 'recursive'));
      continue;
    }
    if (options.collapseAll || options.collapsedPaths?.has(instancePath)) {
      const target = workspace.workflows[targetKey];
      replaceWithPlaceholder(scene, callId, {
        targetLabel: target.name,
        status: 'collapsed',
        nodeCount: target.nodes.length,
        instancePath,
      });
      continue;
    }

    const childAncestors = new Set(ancestors);
    childAncestors.add(targetKey);
    let child = buildFragment(workspace, targetKey, instancePath, childAncestors, options, true, depth + 1);
    const childBounds = sceneBounds(child.nodes);
    const contentWidth = childBounds.width + 260;
    const contentHeight = childBounds.height + 200;
    const shifted = shiftForExpansion(scene.nodes, callId, contentWidth, contentHeight, 280);
    scene.nodes = shifted.nodes;
    const currentCall = scene.nodes.find((node) => node.id === callId)!;
    const boundaryX = currentCall.x;
    const boundaryY = currentCall.y - Math.max(0, (contentHeight - currentCall.height) / 2);
    const boundaryId = `${prefix}/boundary:${reference.nodeId}`;
    scene.nodes = scene.nodes.filter((node) => node.id !== callId);
    const boundary: SceneNode = {
      id: boundaryId,
      kind: 'boundary',
      x: boundaryX,
      y: boundaryY,
      width: contentWidth,
      height: contentHeight,
      zIndex: -1,
      data: {
        label: workspace.workflows[targetKey].name,
        depth: depth + 1,
        instancePath,
        nodeCount: workspace.workflows[targetKey].nodes.length,
        inputAnchor: ((currentCall.y + currentCall.height / 2 - boundaryY) / contentHeight) * 100,
        outputAnchor: ((currentCall.y + currentCall.height / 2 - boundaryY) / contentHeight) * 100,
        entryWarning: child.ambiguousEntry
          ? 'Input trigger is missing, disabled, or ambiguous; possible starts are highlighted.'
          : undefined,
      },
    };
    child = {
      ...child,
      ...translateScene(child, boundaryX + 130 - childBounds.x, boundaryY + 106 - childBounds.y),
    };
    const exitSyncId = `${boundaryId}/simulation-exit`;
    const exitSync: SceneNode = {
      id: exitSyncId,
      kind: 'port',
      x: boundaryX + contentWidth,
      y: boundaryY + (contentHeight * Number(boundary.data.outputAnchor ?? 50) / 100),
      width: 0,
      height: 0,
      data: { simulationOnly: true, boundaryId },
    };
    scene.nodes.push(boundary, exitSync, ...child.nodes);
    scene.edges.push(...child.edges);
    const incoming = scene.edges.filter((edge) => edge.target === callId);
    const outgoing = scene.edges.filter((edge) => edge.source === callId);
    scene.edges = scene.edges.map((edge) => {
      if (edge.target === callId) {
        return { ...edge, target: boundaryId, targetHandle: edge.targetHandle ?? 'in:main:0' };
      }
      if (edge.source === callId) {
        return { ...edge, source: boundaryId, sourceHandle: edge.sourceHandle ?? 'out:main:0', label: child.ambiguousExit ? 'runtime result' : edge.label };
      }
      return edge;
    });
    incoming.forEach((edge) => child.entryIds.forEach((entryId, index) => {
      scene.edges.push({
        ...edge,
        id: `${edge.id}:logical-entry:${index}`,
        target: entryId,
        targetHandle: 'in:main:0',
        hidden: true,
      });
    }));
    child.terminalIds.forEach((terminalId, index) => {
      scene.edges.push({
        id: `${boundaryId}:simulation-exit-arrival:${index}`,
        source: terminalId,
        target: exitSyncId,
        sourceHandle: 'out:main:0',
        targetHandle: `in:main:${index}`,
        connectionType: 'main',
        outputIndex: 0,
        inputIndex: index,
        hidden: true,
      });
    });
    outgoing.forEach((edge, index) => {
      scene.edges.push({
        ...edge,
        id: `${edge.id}:logical-exit:${index}`,
        source: exitSyncId,
        sourceHandle: edge.sourceHandle ?? `out:${edge.connectionType}:${edge.outputIndex}`,
        hidden: true,
      });
    });
  }

  let fragment: Fragment = { ...scene, entryIds: [], terminalIds: [], ambiguousEntry: false, ambiguousExit: false };
  if (hideTrigger) fragment = hideInputTrigger(fragment, workflow, prefix);
  if (hideTrigger) fragment = addExit(fragment);
  return fragment;
}

export function buildExpandedScene(
  workspace: Workspace,
  workflowKey: string,
  options: ExpandedOptions = {},
): GraphScene {
  const ancestors = new Set([workflowKey]);
  const fragment = buildFragment(workspace, workflowKey, workflowKey, ancestors, options, false, 0);
  return { nodes: fragment.nodes, edges: fragment.edges };
}

export const EXPANDED_NODE_SIZE = { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
