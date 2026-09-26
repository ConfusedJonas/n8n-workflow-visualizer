import { describe, expect, it } from 'vitest';
import type { GraphScene } from '../src/renderers/scene';
import { analyzeSimulationGraph, buildSimulationPlan, checkpointsMayConflict } from '../src/simulation/engine';

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
});
