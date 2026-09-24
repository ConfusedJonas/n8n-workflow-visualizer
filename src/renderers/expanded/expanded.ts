import { isWorkflowInputTrigger } from '../../n8n/parser';
import type { NormalizedWorkflow, SubworkflowReference, Workspace } from '../../n8n/types';
import type { GraphScene, SceneEdge, SceneNode } from '../scene';
import { edgeStyle, makeHandle, sceneBounds } from '../scene';
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH, buildOriginalScene } from '../workflow/original';
import { shiftForExpansion } from './layout';

interface Fragment extends GraphScene {
  entryId?: string;
  exitId?: string;
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
    label: reference.targetLabel ?? reference.targetWorkflowId ?? reference.nodeName,
    status,
    targetId: reference.targetWorkflowId,
  };
}

function replaceWithPlaceholder(scene: GraphScene, nodeId: string, data: Record<string, unknown>): string {
  const node = scene.nodes.find((item) => item.id === nodeId);
  if (!node) return nodeId;
  node.kind = 'placeholder';
  node.width = 250;
  node.height = 92;
  node.data = data;
  return node.id;
}

function translateScene(scene: GraphScene, x: number, y: number): GraphScene {
  return {
    nodes: scene.nodes.map((node) => ({ ...node, x: node.x + x, y: node.y + y })),
    edges: scene.edges.map((edge) => ({ ...edge })),
  };
}

function terminalIds(scene: GraphScene): string[] {
  const candidates = scene.nodes.filter((node) => ['workflow', 'placeholder'].includes(node.kind));
  const sources = new Set(scene.edges.filter((edge) => edge.connectionType === 'main').map((edge) => edge.source));
  return candidates.filter((node) => !sources.has(node.id)).map((node) => node.id);
}

function hideInputTrigger(fragment: Fragment, workflow: NormalizedWorkflow, prefix: string): Fragment {
  const triggers = workflow.nodes.filter((node) => isWorkflowInputTrigger(node) && !node.disabled);
  if (triggers.length !== 1) {
    const bounds = sceneBounds(fragment.nodes);
    const portId = `${prefix}/entry:ambiguous`;
    fragment.nodes.push({
      id: portId,
      kind: 'port',
      x: bounds.x - 32,
      y: bounds.y + bounds.height / 2 - 18,
      width: 36,
      height: 36,
      data: { label: triggers.length ? 'Multiple input triggers' : 'Input trigger unavailable', status: 'warning' },
    });
    return { ...fragment, entryId: portId, ambiguousEntry: true };
  }

  const triggerId = `${prefix}/node:${triggers[0].id}`;
  const triggerScene = fragment.nodes.find((node) => node.id === triggerId);
  if (!triggerScene) return fragment;
  const entryId = `${prefix}/entry`;
  fragment.nodes = fragment.nodes.filter((node) => node.id !== triggerId);
  const outgoing = fragment.edges.filter((edge) => edge.source === triggerId);
  fragment.edges = fragment.edges.filter((edge) => edge.source !== triggerId && edge.target !== triggerId);
  fragment.nodes.push({
    id: entryId,
    kind: 'port',
    x: triggerScene.x,
    y: triggerScene.y + triggerScene.height / 2 - 14,
    width: 28,
    height: 28,
    data: { label: 'Input' },
  });
  outgoing.forEach((edge, index) => {
    fragment.edges.push({ ...edge, id: `${entryId}:edge:${index}`, source: entryId, sourceHandle: 'out:main:0' });
  });
  return { ...fragment, entryId, ambiguousEntry: false };
}

function addExit(fragment: Fragment, prefix: string): Fragment {
  const terminals = terminalIds(fragment);
  if (terminals.length === 1) return { ...fragment, exitId: terminals[0], ambiguousExit: false };
  const bounds = sceneBounds(fragment.nodes);
  const exitId = `${prefix}/result`;
  fragment.nodes.push({
    id: exitId,
    kind: 'port',
    x: bounds.x + bounds.width + 18,
    y: bounds.y + bounds.height / 2 - 18,
    width: 36,
    height: 36,
    data: { label: 'Runtime result', status: 'runtime' },
  });
  return { ...fragment, exitId, ambiguousExit: true };
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
  if (!workflow) return { nodes: [], edges: [], ambiguousEntry: true, ambiguousExit: true };
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
        label: target.name,
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
    const contentWidth = childBounds.width + 104;
    const contentHeight = childBounds.height + 100;
    const shifted = shiftForExpansion(scene.nodes, callId, contentWidth, contentHeight);
    scene.nodes = shifted.nodes;
    const currentCall = scene.nodes.find((node) => node.id === callId)!;
    const boundaryX = currentCall.x;
    const boundaryY = currentCall.y - Math.max(0, (contentHeight - currentCall.height) / 2);
    const boundaryId = `${prefix}/boundary:${reference.nodeId}`;
    scene.nodes = scene.nodes.filter((node) => node.id !== callId);
    scene.nodes.push({
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
      },
    });
    child = {
      ...child,
      ...translateScene(child, boundaryX + 52 - childBounds.x, boundaryY + 64 - childBounds.y),
    };
    scene.nodes.push(...child.nodes);
    scene.edges.push(...child.edges);
    const entryId = child.entryId ?? child.nodes.find((node) => node.kind !== 'boundary')?.id;
    const exitId = child.exitId ?? entryId;
    scene.edges = scene.edges.map((edge) => {
      if (edge.target === callId && entryId) {
        return { ...edge, target: entryId, targetHandle: 'in:main:0' };
      }
      if (edge.source === callId && exitId) {
        return { ...edge, source: exitId, sourceHandle: 'out:main:0', label: child.ambiguousExit ? 'runtime result' : edge.label };
      }
      return edge;
    });
  }

  let fragment: Fragment = { ...scene, ambiguousEntry: false, ambiguousExit: false };
  if (hideTrigger) fragment = hideInputTrigger(fragment, workflow, prefix);
  if (hideTrigger) fragment = addExit(fragment, prefix);
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

export function makeSyntheticEdge(
  id: string,
  source: string,
  target: string,
  type = 'main',
): SceneEdge {
  return {
    id,
    source,
    target,
    sourceHandle: makeHandle('out', type, 0),
    targetHandle: makeHandle('in', type, 0),
    connectionType: type,
    outputIndex: 0,
    inputIndex: 0,
    style: edgeStyle(type),
  };
}

export const EXPANDED_NODE_SIZE = { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
