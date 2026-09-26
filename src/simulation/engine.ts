import type { GraphScene, SceneEdge } from '../renderers/scene';

export type SimulationMode = 'random' | 'custom';

export interface SimulationAnalysis {
  starts: Set<string>;
  ends: Set<string>;
  branches: Set<string>;
  loops: Set<string>;
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
    components.push(component);
  };
  ids.forEach((id) => { if (!indices.has(id)) visit(id); });
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

export function analyzeSimulationGraph(scene: GraphScene): SimulationAnalysis {
  const ids = executableNodeIds(scene);
  const edges = executionEdges(scene);
  const incoming = new Map([...ids].map((id) => [id, 0]));
  const outgoing = outgoingMap(ids, edges);
  edges.forEach((edge) => incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1));
  const starts = new Set([...ids].filter((id) => (incoming.get(id) ?? 0) === 0));
  const ends = new Set([...ids].filter((id) => !(outgoing.get(id)?.length)));
  const branches = new Set([...ids].filter((id) => new Set((outgoing.get(id) ?? []).map((edge) => edge.outputIndex)).size > 1));
  const loops = new Set(loopMetadata(ids, outgoing).loopComponents.flat());
  return { starts, ends, branches, loops };
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

function groupedOutputs(edges: SceneEdge[]): SceneEdge[][] {
  const groups = new Map<number, SceneEdge[]>();
  edges.forEach((edge) => groups.set(edge.outputIndex, [...(groups.get(edge.outputIndex) ?? []), edge]));
  return [...groups.entries()].sort(([left], [right]) => left - right).map(([, group]) => group);
}

function cycleSignature(nodes: string[]): string {
  return [...new Set(nodes)].sort().join('\u0000');
}

function cycleSignaturesForGroup(
  start: string,
  group: SceneEdge[],
  outgoing: Map<string, SceneEdge[]>,
  component: Set<string>,
  limit = 128,
): Set<string> {
  const signatures = new Set<string>();
  const walk = (id: string, path: string[], seen: Set<string>) => {
    if (signatures.size >= limit) return;
    if (id === start) {
      signatures.add(cycleSignature(path));
      return;
    }
    if (!component.has(id) || seen.has(id)) return;
    const nextSeen = new Set(seen).add(id);
    const nextPath = [...path, id];
    for (const edge of outgoing.get(id) ?? []) walk(edge.target, nextPath, nextSeen);
  };
  group.forEach((edge) => walk(edge.target, [start], new Set([start])));
  return signatures;
}

function canEscapeWithoutReturning(
  start: string,
  group: SceneEdge[],
  outgoing: Map<string, SceneEdge[]>,
  component: Set<string>,
): boolean {
  const seen = new Set([start]);
  const queue = group.map((edge) => edge.target);
  while (queue.length) {
    const id = queue.shift()!;
    if (!component.has(id)) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    (outgoing.get(id) ?? []).forEach((edge) => queue.push(edge.target));
  }
  return false;
}

function checkpointGuidedGroups(
  groups: SceneEdge[][],
  outgoing: Map<string, SceneEdge[]>,
  remaining: Set<string>,
): SceneEdge[][] {
  if (!remaining.size || groups.length < 2) return groups;
  const scored = groups.map((group) => ({
    group,
    score: new Set(group.flatMap((edge) => [...reachableCheckpoints(edge.target, outgoing, remaining)])).size,
  }));
  const best = Math.max(...scored.map((item) => item.score));
  return best > 0 ? scored.filter((item) => item.score === best).map((item) => item.group) : groups;
}

export function buildSimulationPlan(
  scene: GraphScene,
  mode: SimulationMode,
  checkpoints: Set<string>,
  random: () => number = Math.random,
): string[] {
  const ids = executableNodeIds(scene);
  const edges = executionEdges(scene);
  const outgoing = outgoingMap(ids, edges);
  const analysis = analyzeSimulationGraph(scene);
  const { componentByNode } = loopMetadata(ids, outgoing);
  const remaining = new Set([...checkpoints].filter((id) => ids.has(id)));
  const completedCycles = new Set<string>();
  const allCycleSignatures = new Set<string>();
  const cycleCache = new Map<string, Set<string>>();
  for (const id of analysis.loops) {
    const component = componentByNode.get(id)!;
    groupedOutputs(outgoing.get(id) ?? []).forEach((group) => {
      const key = `${id}:${group[0]?.outputIndex ?? 0}`;
      const signatures = cycleSignaturesForGroup(id, group, outgoing, component);
      cycleCache.set(key, signatures);
      signatures.forEach((signature) => allCycleSignatures.add(signature));
    });
  }

  interface QueueItem { id: string; path: string[] }
  const queue: QueueItem[] = [...analysis.starts].sort().map((id) => ({ id, path: [] }));
  const visits = new Map<string, number>();
  const plan: string[] = [];
  const maxLoopVisits = Math.max(2, allCycleSignatures.size + 2);
  const safetyLimit = Math.max(64, scene.nodes.length * (maxLoopVisits + 2) + edges.length * 4);

  while (queue.length && plan.length < safetyLimit) {
    const item = queue.shift()!;
    const count = visits.get(item.id) ?? 0;
    const maxVisits = analysis.loops.has(item.id) ? maxLoopVisits : 1;
    if (count >= maxVisits) continue;
    visits.set(item.id, count + 1);
    plan.push(item.id);
    remaining.delete(item.id);
    const path = [...item.path, item.id];

    let groups = groupedOutputs(outgoing.get(item.id) ?? []);
    const component = componentByNode.get(item.id);
    if (component && groups.length) {
      const withUnexploredCycles = groups.filter((group) => {
        const key = `${item.id}:${group[0]?.outputIndex ?? 0}`;
        return [...(cycleCache.get(key) ?? [])].some((signature) => !completedCycles.has(signature));
      });
      if (withUnexploredCycles.length) groups = withUnexploredCycles;
      else groups = groups.filter((group) => canEscapeWithoutReturning(item.id, group, outgoing, component));
    }
    if (!groups.length) continue;
    if (mode === 'custom') groups = checkpointGuidedGroups(groups, outgoing, remaining);
    if (groups.length > 1) groups = [groups[Math.min(groups.length - 1, Math.floor(random() * groups.length))]];

    for (const edge of groups.flat()) {
      const repeatedAt = path.lastIndexOf(edge.target);
      if (repeatedAt >= 0) completedCycles.add(cycleSignature(path.slice(repeatedAt)));
      queue.push({ id: edge.target, path });
    }
  }
  return plan;
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
