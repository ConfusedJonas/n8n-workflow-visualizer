import type { GraphScene, SceneEdge } from '../renderers/scene';

export type SimulationMode = 'random' | 'custom';

export interface SimulationAnalysis {
  starts: Set<string>;
  ends: Set<string>;
  branches: Set<string>;
  loops: Set<string>;
  loopGroups: string[][];
}

export interface SimulationStep {
  nodeIds: string[];
  edgeIds: string[];
}

interface SimulationToken {
  id: string;
  path: string[];
  edgeId?: string;
}

function executableNodeIds(scene: GraphScene): Set<string> {
  const mainEdges = scene.edges.filter((edge) => edge.connectionType === 'main' && !edge.inactive);
  const mainParticipants = new Set(mainEdges.flatMap((edge) => [edge.source, edge.target]));
  const connected = new Set(scene.edges.flatMap((edge) => [edge.source, edge.target]));
  return new Set(scene.nodes
    .filter((node) => ['workflow', 'placeholder', 'port'].includes(node.kind)
      && (mainParticipants.has(node.id) || !connected.has(node.id)))
    .map((node) => node.id));
}

function executionEdges(scene: GraphScene): SceneEdge[] {
  const nodes = executableNodeIds(scene);
  return scene.edges.filter((edge) => edge.connectionType === 'main' && !edge.inactive && nodes.has(edge.source) && nodes.has(edge.target));
}

function outgoingMap(ids: Set<string>, edges: SceneEdge[]): Map<string, SceneEdge[]> {
  const outgoing = new Map([...ids].map((id) => [id, [] as SceneEdge[]]));
  edges.forEach((edge) => outgoing.get(edge.source)?.push(edge));
  outgoing.forEach((items) => items.sort((left, right) => left.outputIndex - right.outputIndex || left.target.localeCompare(right.target) || left.id.localeCompare(right.id)));
  return outgoing;
}

function stronglyConnectedComponents(ids: Set<string>, outgoing: Map<string, SceneEdge[]>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string) => {
    indices.set(id, index);
    lowLinks.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (!indices.has(edge.target)) {
        visit(edge.target);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(edge.target)!));
      } else if (onStack.has(edge.target)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indices.get(edge.target)!));
      }
    }
    if (lowLinks.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component.sort());
  };
  [...ids].sort().forEach((id) => { if (!indices.has(id)) visit(id); });
  return components;
}

function loopMetadata(ids: Set<string>, outgoing: Map<string, SceneEdge[]>) {
  const loopComponents = stronglyConnectedComponents(ids, outgoing).filter((component) => (
    component.length > 1 || (outgoing.get(component[0]) ?? []).some((edge) => edge.target === component[0])
  ));
  const componentByNode = new Map<string, Set<string>>();
  loopComponents.forEach((component) => {
    const members = new Set(component);
    component.forEach((id) => componentByNode.set(id, members));
  });
  return { loopComponents, componentByNode };
}

function cycleSignature(nodes: string[]): string {
  return [...new Set(nodes)].sort().join('\u0000');
}

function simpleCycleGroups(ids: Set<string>, outgoing: Map<string, SceneEdge[]>, limit = 256): string[][] {
  const signatures = new Map<string, string[]>();
  const sortedIds = [...ids].sort();
  let traversals = 0;
  for (const start of sortedIds) {
    const walk = (id: string, path: string[], seen: Set<string>) => {
      traversals += 1;
      if (signatures.size >= limit || traversals > limit * 100) return;
      for (const edge of outgoing.get(id) ?? []) {
        if (edge.target === start) {
          const signature = cycleSignature(path);
          if (!signatures.has(signature)) signatures.set(signature, [...new Set(path)].sort());
        } else if (!seen.has(edge.target) && edge.target >= start) {
          walk(edge.target, [...path, edge.target], new Set(seen).add(edge.target));
        }
      }
    };
    walk(start, [start], new Set([start]));
  }
  return [...signatures.values()].sort((left, right) => left.join('\u0000').localeCompare(right.join('\u0000')));
}

export function analyzeSimulationGraph(scene: GraphScene): SimulationAnalysis {
  const ids = executableNodeIds(scene);
  const edges = executionEdges(scene);
  const incoming = new Map([...ids].map((id) => [id, 0]));
  const outgoing = outgoingMap(ids, edges);
  edges.forEach((edge) => incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1));
  const starts = new Set([...ids].filter((id) => (incoming.get(id) ?? 0) === 0));
  const ends = new Set([...ids].filter((id) => !(outgoing.get(id)?.length)));
  const branches = new Set([...ids].filter((id) => new Set((outgoing.get(id) ?? []).map((edge) => edge.outputIndex)).size > 1));
  const loopGroups = simpleCycleGroups(ids, outgoing);
  const loops = new Set(loopMetadata(ids, outgoing).loopComponents.flat());
  return { starts, ends, branches, loops, loopGroups };
}

function reachableCheckpoints(start: string, outgoing: Map<string, SceneEdge[]>, checkpoints: Set<string>): Set<string> {
  const found = new Set<string>();
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (checkpoints.has(id)) found.add(id);
    (outgoing.get(id) ?? []).forEach((edge) => queue.push(edge.target));
  }
  return found;
}

function canReach(start: string, target: string, outgoing: Map<string, SceneEdge[]>): boolean {
  if (start === target) return true;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const edge of outgoing.get(id) ?? []) {
      if (edge.target === target) return true;
      if (!seen.has(edge.target)) {
        seen.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return false;
}

function groupedOutputs(edges: SceneEdge[]): SceneEdge[][] {
  const groups = new Map<number, SceneEdge[]>();
  edges.forEach((edge) => groups.set(edge.outputIndex, [...(groups.get(edge.outputIndex) ?? []), edge]));
  return [...groups.entries()].sort(([left], [right]) => left - right).map(([, group]) => group);
}

function shortestDistance(starts: string[], targets: Set<string>, outgoing: Map<string, SceneEdge[]>, blockedNode?: string): number {
  if (!targets.size) return Number.POSITIVE_INFINITY;
  const queue = starts.map((id) => ({ id, distance: 0 }));
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    if (targets.has(current.id)) return current.distance;
    if (current.id === blockedNode) continue;
    (outgoing.get(current.id) ?? []).forEach((edge) => queue.push({ id: edge.target, distance: current.distance + 1 }));
  }
  return Number.POSITIVE_INFINITY;
}

function untriedBranchDistance(
  group: SceneEdge[],
  outgoing: Map<string, SceneEdge[]>,
  usedOutputs: Map<string, Set<number>>,
  blockedNode?: string,
): number {
  const queue = group.map((edge) => ({ id: edge.target, distance: 0 }));
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    const outputs = groupedOutputs(outgoing.get(current.id) ?? []);
    if (outputs.length > 1) {
      const used = usedOutputs.get(current.id) ?? new Set<number>();
      if (outputs.some((candidate) => !used.has(candidate[0].outputIndex))) return current.distance;
    }
    if (current.id === blockedNode) continue;
    (outgoing.get(current.id) ?? []).forEach((edge) => queue.push({ id: edge.target, distance: current.distance + 1 }));
  }
  return Number.POSITIVE_INFINITY;
}

function selectOutputGroup(
  nodeId: string,
  groups: SceneEdge[][],
  outgoing: Map<string, SceneEdge[]>,
  usedOutputs: Map<string, Set<number>>,
  remaining: Set<string>,
  mode: SimulationMode,
  random: () => number,
): SceneEdge[] | undefined {
  if (!groups.length) return undefined;
  if (groups.length === 1) return groups[0];

  const used = usedOutputs.get(nodeId) ?? new Set<number>();
  const fresh = groups.filter((group) => !used.has(group[0].outputIndex));
  let candidates = fresh;

  // Once every local output has run, revisit a path only when it leads to a
  // downstream branch with an untried output or to an outstanding checkpoint.
  if (!candidates.length) {
    candidates = groups.filter((group) => (
      untriedBranchDistance(group, outgoing, usedOutputs, nodeId) < Number.POSITIVE_INFINITY
      || shortestDistance(group.map((edge) => edge.target), remaining, outgoing, nodeId) < Number.POSITIVE_INFINITY
    ));
  }
  if (!candidates.length) return undefined;

  if (mode === 'custom' && remaining.size) {
    const distances = candidates.map((group) => shortestDistance(group.map((edge) => edge.target), remaining, outgoing, nodeId));
    const nearest = Math.min(...distances);
    if (nearest < Number.POSITIVE_INFINITY) candidates = candidates.filter((_group, index) => distances[index] === nearest);
  } else if (!fresh.length) {
    const distances = candidates.map((group) => untriedBranchDistance(group, outgoing, usedOutputs, nodeId));
    const nearest = Math.min(...distances);
    if (nearest < Number.POSITIVE_INFINITY) candidates = candidates.filter((_group, index) => distances[index] === nearest);
  }

  const selected = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  used.add(selected[0].outputIndex);
  usedOutputs.set(nodeId, used);
  return selected;
}

function visibleEdgeIds(id: string): string[] {
  const logicalAt = id.indexOf(':logical-');
  return logicalAt >= 0 ? [id, id.slice(0, logicalAt)] : [id];
}

export function buildSimulationSteps(
  scene: GraphScene,
  mode: SimulationMode,
  checkpoints: Set<string>,
  random: () => number = Math.random,
): SimulationStep[] {
  const ids = executableNodeIds(scene);
  const edges = executionEdges(scene);
  const outgoing = outgoingMap(ids, edges);
  const analysis = analyzeSimulationGraph(scene);
  const simulationOnly = new Set(scene.nodes.filter((node) => node.data.simulationOnly).map((node) => node.id));
  const remaining = new Set([...checkpoints].filter((id) => ids.has(id)));
  const usedOutputs = new Map<string, Set<number>>();

  const waiting = new Map<string, SimulationToken[]>();
  [...analysis.starts].sort().forEach((id) => waiting.set(id, [{ id, path: [] }]));
  const visits = new Map<string, number>();
  const steps: SimulationStep[] = [];
  const branchOutputBudget = [...analysis.branches].reduce((sum, id) => sum + groupedOutputs(outgoing.get(id) ?? []).length, 0);
  const maxLoopVisits = Math.max(2, Math.min(64, branchOutputBudget + 2));
  const safetyLimit = Math.max(64, scene.nodes.length * (maxLoopVisits + 2) + edges.length * 4);

  while (waiting.size && steps.length < safetyLimit) {
    const candidates = [...waiting.keys()].filter((id) => {
      const count = visits.get(id) ?? 0;
      return count < (analysis.loops.has(id) ? maxLoopVisits : 1);
    });
    for (const id of [...waiting.keys()]) if (!candidates.includes(id)) waiting.delete(id);
    if (!candidates.length) break;

    let ready = candidates.filter((candidate) => analysis.loops.has(candidate) || !candidates.some((other) => (
      other !== candidate && canReach(other, candidate, outgoing)
    )));
    if (!ready.length) ready = [candidates.sort()[0]];
    ready.sort();

    const arrivals = ready.flatMap((id) => waiting.get(id) ?? []);
    const visibleReady = ready.filter((id) => !simulationOnly.has(id));
    if (visibleReady.length) {
      steps.push({
        nodeIds: visibleReady,
        edgeIds: [...new Set(arrivals.flatMap((token) => token.edgeId ? visibleEdgeIds(token.edgeId) : []))],
      });
    }

    const produced: SimulationToken[] = [];
    for (const id of ready) {
      const tokens = waiting.get(id) ?? [{ id, path: [] }];
      waiting.delete(id);
      visits.set(id, (visits.get(id) ?? 0) + 1);
      remaining.delete(id);
      const token = tokens.sort((left, right) => left.path.length - right.path.length || left.path.join('\u0000').localeCompare(right.path.join('\u0000')))[0];
      const path = [...token.path, id];

      const selectedGroup = selectOutputGroup(id, groupedOutputs(outgoing.get(id) ?? []), outgoing, usedOutputs, remaining, mode, random);
      if (!selectedGroup) continue;
      for (const edge of selectedGroup) {
        produced.push({ id: edge.target, path, edgeId: edge.id });
      }
    }
    for (const token of produced) waiting.set(token.id, [...(waiting.get(token.id) ?? []), token]);
  }
  return steps;
}

export function buildSimulationPlan(scene: GraphScene, mode: SimulationMode, checkpoints: Set<string>, random: () => number = Math.random): string[] {
  return buildSimulationSteps(scene, mode, checkpoints, random).flatMap((step) => step.nodeIds);
}

export function checkpointsMayConflict(scene: GraphScene, checkpoints: Set<string>): boolean {
  if (checkpoints.size < 2) return false;
  const ids = executableNodeIds(scene);
  const outgoing = outgoingMap(ids, executionEdges(scene));
  for (const id of analyzeSimulationGraph(scene).branches) {
    const groups = groupedOutputs(outgoing.get(id) ?? []);
    const checkpointGroups = groups.filter((group) => group.some((edge) => reachableCheckpoints(edge.target, outgoing, checkpoints).size > 0));
    if (checkpointGroups.length > 1) return true;
  }
  return false;
}
