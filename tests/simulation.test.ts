import { describe, expect, it } from 'vitest';
import type { GraphScene } from '../src/renderers/scene';
import { analyzeCheckpointConflicts, analyzeSimulationGraph, buildSimulationPlan, buildSimulationSteps, checkpointsMayConflict, simulationFollowTarget } from '../src/simulation/engine';
import { parseN8nDocument } from '../src/n8n/parser';
import { buildExpandedScene } from '../src/renderers/expanded/expanded';
import { createWorkspace } from '../src/workspace/resolve';
import { childWorkflow, mainWorkflow } from './fixtures';

const node = (id: string) => ({ id, kind: 'workflow' as const, x: 0, y: 0, width: 100, height: 80, data: {} });
const edge = (id: string, source: string, target: string, outputIndex = 0) => ({ id, source, target, connectionType: 'main', outputIndex, inputIndex: 0 });

describe('workflow simulation', () => {
  it('detects starts, ends, branches, and loop members', () => {
    const scene: GraphScene = {
      nodes: ['start', 'branch', 'loop', 'end'].map(node),
      edges: [edge('a', 'start', 'branch'), edge('b', 'branch', 'loop', 0), edge('c', 'branch', 'end', 1), edge('d', 'loop', 'branch')],
    };
    const analysis = analyzeSimulationGraph(scene);
    expect([...analysis.starts]).toEqual(['start']);
    expect([...analysis.ends]).toEqual(['end']);
    expect([...analysis.branches]).toEqual(['branch']);
    expect(analysis.loops).toEqual(new Set(['branch', 'loop']));
  });

  it('chooses a branch that can reach a checkpoint', () => {
    const scene: GraphScene = {
      nodes: ['start', 'branch', 'left', 'right'].map(node),
      edges: [edge('a', 'start', 'branch'), edge('b', 'branch', 'left', 0), edge('c', 'branch', 'right', 1)],
    };
    expect(buildSimulationPlan(scene, 'custom', new Set(['right']), () => 0)).toEqual(['start', 'branch', 'right']);
    expect(checkpointsMayConflict(scene, new Set(['left', 'right']))).toBe(true);
  });

  it('does not report sequential checkpoints after reconverging branches as conflicting', () => {
    const scene: GraphScene = {
      nodes: ['start', 'branch', 'left', 'right', 'merge', 'child-one', 'child-two'].map(node),
      edges: [
        edge('a', 'start', 'branch'),
        edge('b', 'branch', 'left', 0), edge('c', 'branch', 'right', 1),
        edge('d', 'left', 'merge'), edge('e', 'right', 'merge'),
        edge('f', 'merge', 'child-one'), edge('g', 'child-one', 'child-two'),
      ],
    };
    expect(analyzeCheckpointConflicts(scene, new Set(['child-one', 'child-two']))).toEqual([]);
  });

  it('finds a shortest route to one destination and stops there', () => {
    const scene: GraphScene = {
      nodes: ['start', 'branch', 'long-one', 'long-two', 'destination', 'after'].map(node),
      edges: [
        edge('a', 'start', 'branch'), edge('b', 'branch', 'long-one', 0), edge('c', 'branch', 'destination', 1),
        edge('d', 'long-one', 'long-two'), edge('e', 'long-two', 'destination'), edge('f', 'destination', 'after'),
      ],
    };
    expect(buildSimulationPlan(scene, 'shortest', new Set(['destination']), () => 0)).toEqual(['start', 'branch', 'destination']);
  });

  it('uses the branch with greatest unvisited coverage in All mode', () => {
    const scene: GraphScene = {
      nodes: ['start', 'branch', 'short', 'long-one', 'long-two', 'long-three'].map(node),
      edges: [
        edge('a', 'start', 'branch'), edge('b', 'branch', 'short', 0), edge('c', 'branch', 'long-one', 1),
        edge('d', 'long-one', 'long-two'), edge('e', 'long-two', 'long-three'),
      ],
    };
    expect(buildSimulationPlan(scene, 'all', new Set(), () => 0)).toEqual(['start', 'branch', 'long-one', 'long-two', 'long-three']);
  });

  it('runs a returning branch before a terminal branch in All mode', () => {
    const scene: GraphScene = {
      nodes: ['start', 'branch', 'loop-body', 'terminal'].map(node),
      edges: [
        edge('a', 'start', 'branch'),
        edge('b', 'branch', 'terminal', 0),
        edge('c', 'branch', 'loop-body', 1),
        edge('d', 'loop-body', 'branch'),
      ],
    };
    expect(buildSimulationPlan(scene, 'all', new Set(), () => 0)).toEqual(['start', 'branch', 'loop-body', 'branch', 'terminal']);
  });

  it('exhausts loop bodies before exits across parallel branches in All mode', () => {
    const nodeIds = ['start', 'merge', 'end'];
    const edges = [];
    for (let index = 1; index <= 4; index += 1) {
      nodeIds.push(`loop-${index}`, `body-${index}`, `done-${index}`);
      edges.push(
        edge(`fan-${index}`, 'start', `loop-${index}`),
        edge(`done-${index}`, `loop-${index}`, `done-${index}`, 0),
        edge(`body-${index}`, `loop-${index}`, `body-${index}`, 1),
        edge(`return-${index}`, `body-${index}`, `loop-${index}`),
        edge(`join-${index}`, `done-${index}`, 'merge'),
      );
    }
    edges.push(edge('finish', 'merge', 'end'));
    const plan = buildSimulationPlan({ nodes: nodeIds.map(node), edges }, 'all', new Set(), () => 0);
    for (let index = 1; index <= 4; index += 1) {
      expect(plan.indexOf(`body-${index}`)).toBeGreaterThan(-1);
      expect(plan.indexOf(`body-${index}`)).toBeLessThan(plan.indexOf(`done-${index}`));
    }
    expect(plan.at(-1)).toBe('end');
  });

  it('does not mistake leaving and re-entering an expanded boundary for a local loop path', () => {
    const inside = (id: string) => ({ ...node(id), data: { simulationBoundaries: ['box'] } });
    const sync: GraphScene['nodes'][number] = { ...inside('sync'), kind: 'port', data: { simulationOnly: true, boundaryId: 'box', simulationBoundaries: ['box'] } };
    const scene: GraphScene = {
      nodes: [node('root'), inside('loop'), inside('body'), inside('done'), sync, node('after')],
      edges: [
        { ...edge('enter', 'root', 'loop'), simulationBoundary: 'box', simulationRole: 'entry' },
        edge('done-output', 'loop', 'done', 0),
        edge('body-output', 'loop', 'body', 1),
        edge('body-return', 'body', 'loop'),
        { ...edge('arrival', 'done', 'sync'), simulationBoundary: 'box', simulationRole: 'arrival' },
        { ...edge('release', 'sync', 'after'), simulationBoundary: 'box', simulationRole: 'release' },
        { ...edge('external-return', 'after', 'loop'), simulationBoundary: 'box', simulationRole: 'entry' },
      ],
    };
    const plan = buildSimulationPlan(scene, 'all', new Set(), () => 0);
    expect(plan.indexOf('body')).toBeGreaterThan(-1);
    expect(plan.indexOf('body')).toBeLessThan(plan.indexOf('done'));
  });

  it('looks ahead along the longest active parallel branch for Follow mode', () => {
    const scene: GraphScene = {
      nodes: ['start', 'short', 'long-one', 'long-two', 'merge', 'end'].map(node),
      edges: [
        edge('a', 'start', 'short'), edge('b', 'start', 'long-one'),
        edge('c', 'short', 'merge'), edge('d', 'long-one', 'long-two'),
        edge('e', 'long-two', 'merge'), edge('f', 'merge', 'end'),
      ],
    };
    const plan = buildSimulationSteps(scene, 'all', new Set(), () => 0);
    expect(plan[1].nodeIds.sort()).toEqual(['long-one', 'short']);
    expect(simulationFollowTarget(scene, plan, 0)).toBe('long-two');
    expect(simulationFollowTarget(scene, plan, 1)).toBe('long-two');
  });

  it('traverses a loop only once before using an available exit', () => {
    const scene: GraphScene = {
      nodes: ['start', 'branch', 'loop', 'end'].map(node),
      edges: [edge('a', 'start', 'branch'), edge('b', 'branch', 'loop', 0), edge('c', 'branch', 'end', 1), edge('d', 'loop', 'branch')],
    };
    const plan = buildSimulationPlan(scene, 'random', new Set(), () => 0);
    expect(plan).toEqual(['start', 'branch', 'loop', 'branch', 'end']);
  });

  it('uses the shortest untried branch toward an outside checkpoint', () => {
    const scene: GraphScene = {
      nodes: ['start', 'gate', 'split', 'left', 'right', 'checkpoint', 'end'].map(node),
      edges: [
        edge('a', 'start', 'gate'),
        edge('b', 'gate', 'split', 0),
        edge('c', 'gate', 'checkpoint', 1),
        edge('d', 'split', 'left', 0),
        edge('e', 'split', 'right', 1),
        edge('f', 'left', 'gate'),
        edge('g', 'right', 'gate'),
        edge('h', 'checkpoint', 'end'),
      ],
    };
    const plan = buildSimulationPlan(scene, 'custom', new Set(['checkpoint']), () => 0);
    expect(plan).toEqual(['start', 'gate', 'checkpoint', 'end']);
  });

  it('runs each parallel loop output at most once, merges once, and reaches the checkpoint', () => {
    const nodeIds = ['start', 'merge', 'checkpoint'];
    const edges = [edge('start-fan', 'start', 'loop-1')];
    for (let index = 1; index <= 4; index += 1) {
      nodeIds.push(`loop-${index}`, `body-${index}`, `done-${index}`);
      if (index > 1) edges.push(edge(`start-fan-${index}`, 'start', `loop-${index}`));
      edges.push(
        edge(`exit-${index}`, `loop-${index}`, `done-${index}`, 0),
        edge(`body-edge-${index}`, `loop-${index}`, `body-${index}`, 1),
        edge(`return-${index}`, `body-${index}`, `loop-${index}`),
        edge(`merge-${index}`, `done-${index}`, 'merge'),
      );
    }
    edges.push(edge('finish', 'merge', 'checkpoint'));
    const steps = buildSimulationSteps({ nodes: nodeIds.map(node), edges }, 'random', new Set(), () => 0.99);
    const plan = steps.flatMap((step) => step.nodeIds);
    expect(plan.at(-1)).toBe('checkpoint');
    expect(plan.filter((id) => id === 'merge')).toHaveLength(1);
    for (let index = 1; index <= 4; index += 1) {
      expect(plan.filter((id) => id === `loop-${index}`).length).toBeLessThanOrEqual(2);
      expect(plan).toContain(`done-${index}`);
    }
  });

  it('runs fan-out nodes together and waits for every live branch at a merge', () => {
    const scene: GraphScene = {
      nodes: ['start', 'fan', 'short', 'long-1', 'long-2', 'merge', 'end'].map(node),
      edges: [
        edge('a', 'start', 'fan'),
        edge('b', 'fan', 'short'),
        edge('c', 'fan', 'long-1'),
        edge('d', 'short', 'merge'),
        edge('e', 'long-1', 'long-2'),
        edge('f', 'long-2', 'merge'),
        edge('g', 'merge', 'end'),
      ],
    };
    expect(buildSimulationSteps(scene, 'random', new Set(), () => 0).map((step) => step.nodeIds)).toEqual([
      ['start'], ['fan'], ['long-1', 'short'], ['long-2'], ['merge'], ['end'],
    ]);
  });

  it('waits for every active sub-workflow terminal and releases one outside signal', () => {
    const parsed = [mainWorkflow(), childWorkflow()].map((raw) => parseN8nDocument(raw).workflows[0]);
    const scene = buildExpandedScene(createWorkspace(parsed), 'workflow:main');
    const steps = buildSimulationSteps(scene, 'random', new Set(), () => 0);
    const labels = steps.map((step) => step.nodeIds.map((id) => String(scene.nodes.find((item) => item.id === id)?.data.label)));
    expect(labels).toEqual([
      ['Start'],
      ['Left branch', 'Right branch'],
      ['Finish'],
    ]);
    expect(steps.flatMap((step) => step.nodeIds).filter((id) => id.endsWith('/node:finish'))).toHaveLength(1);
  });

  it('keeps an exit synchronizer inside an outer loop blocked until unequal parallel paths finish', () => {
    const sync: GraphScene['nodes'][number] = { ...node('sync'), kind: 'port', data: { simulationOnly: true, boundaryId: 'box', simulationBoundaries: ['box'] } };
    const scene: GraphScene = {
      nodes: [...['root', 'start', 'short', 'long-1', 'long-2', 'after'].map(node), sync],
      edges: [
        { ...edge('enter', 'root', 'start'), simulationBoundary: 'box', simulationRole: 'entry' as const },
        edge('fan-short', 'start', 'short'),
        edge('fan-long', 'start', 'long-1'),
        { ...edge('short-arrival', 'short', 'sync'), simulationBoundary: 'box', simulationRole: 'arrival' as const },
        edge('long-next', 'long-1', 'long-2'),
        { ...edge('long-arrival', 'long-2', 'sync'), simulationBoundary: 'box', simulationRole: 'arrival' as const },
        { ...edge('release', 'sync', 'after'), simulationBoundary: 'box', simulationRole: 'release' as const },
        { ...edge('outer-loop', 'after', 'start'), simulationBoundary: 'box', simulationRole: 'entry' as const },
      ],
    };
    expect(buildSimulationSteps(scene, 'random', new Set(), () => 0).slice(0, 4).map((step) => step.nodeIds)).toEqual([
      ['root'],
      ['start'],
      ['long-1', 'short'],
      ['long-2'],
    ]);
    expect(buildSimulationSteps(scene, 'random', new Set(), () => 0)[4]?.nodeIds).toEqual(['after']);
  });

  it('assigns separate indicators to distinct loop paths', () => {
    const scene: GraphScene = {
      nodes: ['gate', 'left', 'right'].map(node),
      edges: [
        edge('a', 'gate', 'left', 0), edge('b', 'left', 'gate'),
        edge('c', 'gate', 'right', 1), edge('d', 'right', 'gate'),
      ],
    };
    expect(analyzeSimulationGraph(scene).loopGroups).toEqual([
      ['gate', 'left'],
      ['gate', 'right'],
    ]);
  });
});
