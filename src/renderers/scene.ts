import type { CSSProperties } from 'react';

export type SceneNodeKind =
  | 'workflow'
  | 'sticky'
  | 'boundary'
  | 'placeholder'
  | 'port'
  | 'dependency';

export interface SceneNode {
  id: string;
  kind: SceneNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
  data: Record<string, unknown>;
}
export interface SceneEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  connectionType: string;
  outputIndex: number;
  inputIndex: number;
  label?: string;
  inactive?: boolean;
  hidden?: boolean;
  style?: CSSProperties;
}

export interface GraphScene {
  nodes: SceneNode[];
  edges: SceneEdge[];
}

export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function sceneBounds(nodes: SceneNode[]): SceneBounds {
  if (!nodes.length) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function connectionColor(type: string): string {
  const colors: Record<string, string> = {
    main: '#8f93a2',
    ai_languageModel: '#a78bfa',
    ai_tool: '#38bdf8',
    ai_memory: '#34d399',
    ai_embedding: '#f59e0b',
    ai_vectorStore: '#fb7185',
    ai_outputParser: '#c084fc',
    ai_retriever: '#22d3ee',
  };
  return colors[type] ?? '#d977e8';
}

export function edgeStyle(type: string, inactive = false): CSSProperties {
  return {
    stroke: connectionColor(type),
    strokeWidth: type === 'main' ? 2 : 1.8,
    strokeDasharray: inactive ? '7 6' : type === 'main' ? undefined : '4 3',
    opacity: inactive ? 0.42 : 0.9,
  };
}

export function makeHandle(direction: 'in' | 'out', type: string, index: number): string {
  return `${direction}:${type}:${index}`;
}
