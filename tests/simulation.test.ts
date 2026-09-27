import { describe, expect, it } from 'vitest';
import type { GraphScene } from '../src/renderers/scene';
import { analyzeSimulationGraph, buildSimulationPlan, buildSimulationSteps, checkpointsMayConflict } from '../src/simulation/engine';

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
