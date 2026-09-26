import type { SceneNode } from '../scene';

function intersects(a: SceneNode, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
export interface ExpansionShiftResult {
  nodes: SceneNode[];
  delta: number;
}

export function shiftForExpansion(
  nodes: SceneNode[],
  anchorId: string,
  expansionWidth: number,
  expansionHeight: number,
  gap = 220,
): ExpansionShiftResult {
  const anchor = nodes.find((node) => node.id === anchorId);
  if (!anchor) return { nodes, delta: 0 };
  const delta = Math.max(0, expansionWidth - anchor.width + gap);
  if (!delta) return { nodes, delta: 0 };
  const expansionRect = {
    x: anchor.x,
    y: anchor.y - Math.max(0, (expansionHeight - anchor.height) / 2),
    width: expansionWidth,
    height: expansionHeight,
  };
  return {
    delta,
    nodes: nodes.map((node) => {
      if (node.id === anchorId) return node;
      const downstream = node.x > anchor.x;
      const colliding = intersects(node, expansionRect) && node.x + node.width > anchor.x;
      return downstream || colliding ? { ...node, x: node.x + delta } : node;
    }),
  };
}
