import type { GraphScene, SceneEdge } from '../renderers/scene';

export type SimulationMode = 'random' | 'custom';

export interface SimulationAnalysis {
  starts: Set<string>;
  ends: Set<string>;
  branches: Set<string>;
  loops: Set<string>;
}

function executableNodeIds(scene: GraphScene): Set<string> {
  return new Set(scene.nodes.filter((node) => ['workflow', 'placeholder', 'port'].includes(node.kind)).map((node) => node.id));
}

function executionEdges(scene: GraphScene): SceneEdge[] {
  const nodes = executableNodeIds(scene);
  return scene.edges.filter((edge) => edge.connectionType === 'main' && !edge.inactive && nodes.has(edge.source) && nodes.has(edge.target));
}

export function analyzeSimulationGraph(scene: GraphScene): SimulationAnalysis {
  const ids = executableNodeIds(scene);
  const edges = executionEdges(scene);
  const incoming = new Map([...ids].map((id) => [id, 0]));
  const outgoing = new Map([...ids].map((id) => [id, [] as SceneEdge[]]));
  edges.forEach((edge) => {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge);
  });

  const starts = new Set([...ids].filter((id) => (incoming.get(id) ?? 0) === 0));
  const ends = new Set([...ids].filter((id) => !(outgoing.get(id)?.length)));
  const branches = new Set([...ids].filter((id) => new Set((outgoing.get(id) ?? []).map((edge) => edge.outputIndex)).size > 1));

  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const loops = new Set<string>();
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
    if (component.length > 1 || (outgoing.get(id) ?? []).some((edge) => edge.target === id)) component.forEach((item) => loops.add(item));
  };
  ids.forEach((id) => { if (!indices.has(id)) visit(id); });
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

export function buildSimulationPlan(
  scene: GraphScene,
  mode: SimulationMode,
  checkpoints: Set<string>,
  random: () => number = Math.random,
): string[] {
  const analysis = analyzeSimulationGraph(scene);
  const edges = executionEdges(scene);
  const outgoing = new Map<string, SceneEdge[]>();
  edges.forEach((edge) => outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]));
  const remaining = new Set([...checkpoints].filter((id) => scene.nodes.some((node) => node.id === id)));
  const queue = [...analysis.starts].sort();
  const usedEdges = new Set<string>();
  const visits = new Map<string, number>();
  const plan: string[] = [];
  const safetyLimit = Math.max(32, scene.nodes.length * 4 + edges.length * 2);

  while (queue.length && plan.length < safetyLimit) {
    const id = queue.shift()!;
    const count = visits.get(id) ?? 0;
    const maxVisits = analysis.loops.has(id) ? 2 : 1;
    if (count >= maxVisits) continue;
    visits.set(id, count + 1);
    plan.push(id);
    remaining.delete(id);

    const available = (outgoing.get(id) ?? []).filter((edge) => !usedEdges.has(edge.id));
    let groups = groupedOutputs(available);
    if (groups.length > 1) {
      if (mode === 'custom' && remaining.size) {
        const scored = groups.map((group) => ({
          group,
          score: new Set(group.flatMap((edge) => [...reachableCheckpoints(edge.target, outgoing, remaining)])).size,
        }));
        const best = Math.max(...scored.map((item) => item.score));
        if (best > 0) groups = scored.filter((item) => item.score === best).map((item) => item.group);
      }
      groups = [groups[Math.min(groups.length - 1, Math.floor(random() * groups.length))]];
    }
    for (const edge of groups.flat()) {
      usedEdges.add(edge.id);
      queue.push(edge.target);
    }
  }
  return plan;
}

export function checkpointsMayConflict(scene: GraphScene, checkpoints: Set<string>): boolean {
  if (checkpoints.size < 2) return false;
  const edges = executionEdges(scene);
  const outgoing = new Map<string, SceneEdge[]>();
  edges.forEach((edge) => outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]));
  for (const id of analyzeSimulationGraph(scene).branches) {
    const groups = groupedOutputs(outgoing.get(id) ?? []);
    const checkpointGroups = groups.filter((group) => group.some((edge) => reachableCheckpoints(edge.target, outgoing, checkpoints).size > 0));
    if (checkpointGroups.length > 1) return true;
  }
  return false;
}
