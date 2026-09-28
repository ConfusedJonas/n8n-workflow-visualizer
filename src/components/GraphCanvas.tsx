import {
  Background,
  BaseEdge,
  ControlButton,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodes,
  useNodesState,
  useUpdateNodeInternals,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import { getSmoothStepPath } from '@xyflow/react';
import {
  Bot,
  Braces,
  CircleHelp,
  Clock3,
  Code2,
  Globe2,
  Layers3,
  ListTree,
  MousePointer2,
  SquarePen,
  Split,
  Workflow,
  Wrench,
} from 'lucide-react';
import {
  siConfluence,
  siGithub,
  siGmail,
  siGooglesheets,
  siJira,
  siMongodb,
  siMysql,
  siNotion,
  siPostgresql,
  type SimpleIcon,
} from 'simple-icons';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { GraphScene, SceneNode } from '../renderers/scene';
import { connectionColor } from '../renderers/scene';
import { exportGraphStage, type ExportFormat } from '../export/exportDiagram';
import type { CheckpointConflictGroup } from '../simulation/engine';

interface CanvasNodeData extends Record<string, unknown> {
  label?: string;
  nodeType?: string;
  detail?: string;
  inputCount?: number;
  outputCount?: number;
  disabled?: boolean;
  content?: string;
  color?: number | string;
  status?: string;
  nodeCount?: number;
  missingCount?: number;
  selected?: boolean;
  instancePath?: string;
  inputHandles?: string[];
  outputHandles?: string[];
  inputLabels?: Record<string, string>;
  outputLabels?: Record<string, string>;
  onToggle?: (path: string) => void;
  isSimulationActive?: boolean;
  isSimulationExecuted?: boolean;
  executionCount?: number;
  isCheckpoint?: boolean;
  isConflict?: boolean;
  conflictNumbers?: number[];
  boundaryRole?: string;
  boundaryEntry?: boolean;
  boundaryExit?: boolean;
  inputAnchor?: number;
  outputAnchor?: number;
  entryWarning?: string;
}

type CanvasNode = Node<CanvasNodeData>;

export interface GraphCanvasHandle {
  fit(): void;
  getStage(): HTMLDivElement | null;
  export(format: ExportFormat, workflowName: string, viewName: string): Promise<void>;
}

interface GraphCanvasProps {
  scene: GraphScene;
  onTogglePath?: (path: string) => void;
  onNodeActivate?: (id: string) => void;
  highlightMissing?: boolean;
  activeNodeIds?: Set<string>;
  activeEdgeIds?: Set<string>;
  executedCounts?: Map<string, number>;
  executedEdgeIds?: Set<string>;
  checkpointIds?: Set<string>;
  conflictGroups?: CheckpointConflictGroup[];
  showConflicts?: boolean;
  followActive?: boolean;
  followNodeId?: string;
  followLookaheadNodeId?: string;
}

const stickyColors: Record<number, { background: string; border: string }> = {
  1: { background: '#554c08', border: '#81761b' },
  2: { background: '#5a3d08', border: '#93691a' },
  3: { background: '#5b1016', border: '#8b2028' },
  4: { background: '#073e26', border: '#14683f' },
  5: { background: '#12395f', border: '#245d91' },
  6: { background: '#341566', border: '#583092' },
  7: { background: '#29292e', border: '#484850' },
};
const EMPTY_IDS = new Set<string>();
const EMPTY_COUNTS = new Map<string, number>();

function stateClasses(data: CanvasNodeData): string {
  return [
    data.isSimulationActive ? 'is-simulation-active' : '',
    data.isSimulationExecuted ? 'is-simulation-executed' : '',
    data.isCheckpoint ? 'is-checkpoint' : '',
    data.isConflict ? 'is-conflict-node' : '',
  ].filter(Boolean).join(' ');
}

const conflictColors = ['#ff6b81', '#f6ad55', '#f472b6', '#c084fc', '#38bdf8', '#84cc16'];

function NodeIndicators({ data }: { data: CanvasNodeData }) {
  return (
    <>
      {Number(data.executionCount ?? 0) > 1 ? <span className="execution-count" title="Execution count">×{Number(data.executionCount)}</span> : null}
      {data.isConflict && data.conflictNumbers?.length ? (
        <span className="conflict-indicators" aria-label={`Conflicts ${data.conflictNumbers.join(', ')}`}>
          {data.conflictNumbers.map((number) => <b key={number} style={{ '--conflict-color': conflictColors[(number - 1) % conflictColors.length] } as React.CSSProperties}>C{number}</b>)}
        </span>
      ) : null}
    </>
  );
}

function handleStyle(handle: string, handles: string[], mainOffsets?: number[]): React.CSSProperties {
  const [, type] = handle.split(':');
  if (type !== 'main') {
    const sameSide = handles.filter((candidate) => candidate.split(':')[1] !== 'main');
    const index = sameSide.indexOf(handle);
    return { left: `${((index + 1) / (sameSide.length + 1)) * 100}%`, background: connectionColor(type) };
  }
  const sameSide = handles.filter((candidate) => candidate.split(':')[1] === 'main');
  const index = sameSide.indexOf(handle);
  const top = mainOffsets?.[index] ?? ((index + 1) / (sameSide.length + 1)) * 100;
  return { top: `${top}%`, background: connectionColor(type) };
}

function Handles({ data }: { data: CanvasNodeData }) {
  const inputs = data.inputHandles ?? [];
  const outputs = data.outputHandles ?? [];
  const ifOutputOffsets = String(data.nodeType ?? '').toLowerCase().endsWith('.if') ? [30, 70] : undefined;
  return (
    <>
      {inputs.map((id) => {
        const ai = id.split(':')[1] !== 'main';
        const style = handleStyle(id, inputs);
        return (
          <span key={id}>
            <Handle id={id} type="target" position={ai ? Position.Top : Position.Left} style={style} />
            {data.inputLabels?.[id] ? <span className="handle-label input-label" style={{ top: style.top }}>{data.inputLabels[id]}</span> : null}
          </span>
        );
      })}
      {outputs.map((id) => {
        const ai = id.split(':')[1] !== 'main';
        const style = handleStyle(id, outputs, ifOutputOffsets);
        return (
          <span key={id}>
            <Handle id={id} type="source" position={ai ? Position.Bottom : Position.Right} style={style} />
            {data.outputLabels?.[id] ? <span className="handle-label output-label" style={{ top: style.top }}>{data.outputLabels[id]}</span> : null}
          </span>
        );
      })}
    </>
  );
}

type NodeShape = 'square' | 'circle';
type CoreGlyph = 'aggregate' | 'execute' | 'http' | 'if' | 'manual' | 'merge';

interface NodeAppearance {
  color: string;
  shape: NodeShape;
  lucide?: typeof CircleHelp;
  brand?: SimpleIcon;
  core?: CoreGlyph;
}

const brandNodes: Array<[string, SimpleIcon, string?]> = [
  ['postgres', siPostgresql],
  ['mysql', siMysql],
  ['mongo', siMongodb],
  ['github', siGithub, '#f2f2f2'],
  ['notion', siNotion, '#f2f2f2'],
  ['gmail', siGmail],
  ['googlesheets', siGooglesheets],
  ['jira', siJira],
  ['confluence', siConfluence],
];

function appearanceFor(type = ''): NodeAppearance {
  const normalized = type.toLowerCase();
  const brand = brandNodes.find(([needle]) => normalized.includes(needle));
  if (brand) return { brand: brand[1], color: brand[2] ?? `#${brand[1].hex}`, shape: 'square' };

  const isAiSubnode = /(?:lmchat|language.?model|memory|embedding|vectorstore|retriever|outputparser|tool)/.test(normalized);
  if (isAiSubnode) {
    const lucide = normalized.includes('tool') ? Wrench : Bot;
    return { lucide, color: normalized.includes('memory') ? '#34d399' : '#a78bfa', shape: 'circle' };
  }
  if (normalized.includes('manualtrigger')) return { core: 'manual', color: '#f3f3f5', shape: 'square' };
  if (normalized.includes('executeworkflowtrigger')) return { lucide: Workflow, color: '#ff6d00', shape: 'square' };
  if (normalized.includes('trigger') || normalized.includes('webhook')) return { lucide: normalized.includes('webhook') ? Globe2 : MousePointer2, color: '#f3f3f5', shape: 'square' };
  if (normalized.includes('executeworkflow')) return { core: 'execute', color: '#ff6d00', shape: 'square' };
  if (normalized.includes('workflow')) return { lucide: Workflow, color: '#ff6d00', shape: 'square' };
  if (normalized.includes('http')) return { core: 'http', color: '#4aa7f5', shape: 'square' };
  if (normalized.includes('code') || normalized.includes('function')) return { lucide: Code2, color: '#ffb454', shape: 'square' };
  if (normalized.endsWith('.if')) return { core: 'if', color: '#00c875', shape: 'square' };
  if (normalized.includes('switch')) return { lucide: Split, color: '#00c875', shape: 'square' };
  if (normalized.includes('merge')) return { core: 'merge', color: '#65cbd6', shape: 'square' };
  if (normalized.includes('splitout') || normalized.includes('splitinbatches')) return { lucide: Split, color: '#56b6c2', shape: 'square' };
  if (normalized.includes('aggregate')) return { core: 'aggregate', color: '#ff6d00', shape: 'square' };
  if (normalized.includes('itemlists')) return { lucide: ListTree, color: '#56b6c2', shape: 'square' };
  if (normalized.includes('schedule') || normalized.includes('cron')) return { lucide: Clock3, color: '#ffb454', shape: 'square' };
  if (normalized.endsWith('.set') || normalized.includes('editfields')) return { lucide: SquarePen, color: '#7c83f7', shape: 'square' };
  if (normalized.includes('agent') || normalized.includes('model')) return { lucide: Bot, color: '#a78bfa', shape: 'circle' };
  if (normalized.includes('tool')) return { lucide: Wrench, color: '#38bdf8', shape: 'circle' };
  if (normalized.includes('json') || normalized.includes('xml')) return { lucide: Braces, color: '#e5c07b', shape: 'square' };
  return { lucide: CircleHelp, color: '#a0a1ad', shape: 'square' };
}

function BrandIcon({ icon }: { icon: SimpleIcon }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={icon.title}>
      <path d={icon.path} fill="currentColor" />
    </svg>
  );
}

function CoreIcon({ glyph }: { glyph: CoreGlyph }) {
  if (glyph === 'manual') {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M15 10v22l6.2-5 5.1 10 5-2.5-5.1-9.6 8-.8L15 10Z" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
        <path d="m9 8-2.7-3M8 15H4M13 5V1" fill="none" stroke="#ff6d00" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (glyph === 'execute') {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M10 8v32M10 24h25m-8-9 9 9-9 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (glyph === 'http') {
    return (
      <svg viewBox="0 0 48 48" aria-label="HTTP Request" role="img">
        <circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" strokeWidth="3" />
        <ellipse cx="24" cy="24" rx="7.5" ry="17" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M7 24h34" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (glyph === 'if') {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M9 12h8c6 0 7 12 14 12h7M31 12h7m-5-5 5 5-5 5M31 36h7m-5-5 5 5-5 5M9 36h8c6 0 7-12 14-12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (glyph === 'merge') {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M7 9h8c8 0 8 15 16 15h10M7 19h7c5 0 7 5 10 5M7 29h7c5 0 7-5 10-5M7 39h8c8 0 8-15 16-15" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M8 13h15m-15 11h15M8 35h15m2-27v32m0-16h14m-6-7 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WorkflowNode({ data }: NodeProps<CanvasNode>) {
  const appearance = appearanceFor(data.nodeType);
  const firstConflict = data.conflictNumbers?.[0];
  const style = { '--node-accent': appearance.color, '--conflict-color': firstConflict ? conflictColors[(firstConflict - 1) % conflictColors.length] : undefined } as React.CSSProperties;
  return (
    <div className={`canvas-node ${data.disabled ? 'is-disabled' : ''} ${stateClasses(data)}`} style={style}>
      <div className={`node-tile shape-${appearance.shape}`}>
        <Handles data={data} />
        <span className="node-symbol">
          <AppearanceGlyph appearance={appearance} />
        </span>
        <NodeIndicators data={data} />
      </div>
      <span className="node-copy" title={String(data.label ?? 'Unnamed node')}>
        <strong>{String(data.label ?? 'Unnamed node')}</strong>
        {data.detail ? <small>{String(data.detail)}</small> : null}
      </span>
      {data.disabled ? <span className="node-badge">Disabled</span> : null}
    </div>
  );
}

function AppearanceGlyph({ appearance }: { appearance: NodeAppearance }) {
  const Icon = appearance.lucide ?? CircleHelp;
  return appearance.brand
    ? <BrandIcon icon={appearance.brand} />
    : appearance.core
      ? <CoreIcon glyph={appearance.core} />
      : <Icon size={40} strokeWidth={1.7} />;
}

function safeHref(href?: string): string | undefined {
  if (!href) return undefined;
  return /^(https?:|mailto:)/i.test(href) ? href : undefined;
}

function StickyNode({ data }: NodeProps<CanvasNode>) {
  const custom = typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : undefined;
  const preset = stickyColors[Math.min(7, Math.max(1, Math.floor(Number(data.color) || 1)))] ?? stickyColors[1];
  const background = custom ?? preset.background;
  const border = custom ? `color-mix(in srgb, ${custom} 72%, white)` : preset.border;
  return (
    <article className="sticky-note" style={{ background, borderColor: border, color: '#f2eff5' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            const safe = safeHref(href);
            return safe ? <a href={safe} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
          },
          img: ({ alt }) => <span className="blocked-media">[Image blocked{alt ? `: ${alt}` : ''}]</span>,
        }}
      >
        {String(data.content ?? '')}
      </ReactMarkdown>
    </article>
  );
}

function PlaceholderNode({ data }: NodeProps<CanvasNode>) {
  if (!data.nodeType) {
    return (
      <div className={`placeholder-card status-${String(data.status ?? 'unknown')}`}>
        <Handles data={data} />
        <CircleHelp size={20} />
        <span><strong>{String(data.label ?? 'Unresolved workflow')}</strong><small>{String(data.status ?? 'unknown')}</small></span>
      </div>
    );
  }
  const appearance = appearanceFor(data.nodeType);
  const expandable = data.status === 'collapsed' && typeof data.instancePath === 'string';
  const status = String(data.status ?? 'unknown');
  const firstConflict = data.conflictNumbers?.[0];
  const style = { '--node-accent': appearance.color, '--conflict-color': firstConflict ? conflictColors[(firstConflict - 1) % conflictColors.length] : undefined } as React.CSSProperties;
  return (
    <div className={`canvas-node placeholder-node status-${status} ${stateClasses(data)}`} style={style} title={String(data.targetLabel ?? data.label ?? '')}>
      <div className={`node-tile shape-${appearance.shape}`}>
        <Handles data={data} />
        <span className="node-symbol"><AppearanceGlyph appearance={appearance} /></span>
        <NodeIndicators data={data} />
      </div>
      <span className="node-copy">
        <strong>{String(data.label ?? 'Unresolved workflow')}</strong>
        {data.detail ? <small>{String(data.detail)}</small> : null}
      </span>
      <span className="node-badge">{expandable ? 'Expand' : status}</span>
    </div>
  );
}

function BoundaryNode({ data }: NodeProps<CanvasNode>) {
  const inputTop = `${Number(data.inputAnchor ?? 50)}%`;
  const outputTop = `${Number(data.outputAnchor ?? 50)}%`;
  return (
    <section className="workflow-boundary" title="Click to collapse this sub-workflow">
      {(data.inputHandles ?? []).map((id) => <Handle key={id} id={id} type="target" position={Position.Left} className="boundary-handle" style={{ top: inputTop }} />)}
      {(data.outputHandles ?? []).map((id) => <Handle key={id} id={id} type="source" position={Position.Right} className="boundary-handle" style={{ top: outputTop }} />)}
      <header>
        <span><Layers3 size={16} /> {String(data.label ?? 'Sub-workflow')}</span>
        <small>{data.entryWarning ? String(data.entryWarning) : 'Click background to collapse'}</small>
      </header>
    </section>
  );
}

function PortNode({ data }: NodeProps<CanvasNode>) {
  return (
    <div className={`boundary-port status-${String(data.status ?? '')} ${stateClasses(data)}`} title={String(data.label ?? '')}>
      <Handles data={data} />
      <span>{String(data.label ?? 'Port')}</span>
    </div>
  );
}

function DependencyNode({ data }: NodeProps<CanvasNode>) {
  return (
    <div className={`dependency-card ${data.selected ? 'is-selected' : ''}`}>
      <Handles data={data} />
      <Workflow size={22} />
      <span><strong>{String(data.label ?? 'Workflow')}</strong><small>{Number(data.nodeCount ?? 0)} nodes{Number(data.missingCount ?? 0) ? ` · ${Number(data.missingCount)} missing` : ''}</small></span>
    </div>
  );
}

const nodeTypes = {
  workflow: WorkflowNode,
  sticky: StickyNode,
  placeholder: PlaceholderNode,
  boundary: BoundaryNode,
  port: PortNode,
  dependency: DependencyNode,
};

interface RoutePoint { x: number; y: number }

interface RouteRect { left: number; right: number; top: number; bottom: number }

function nodeRect(node: Node, clearanceOverride?: number): RouteRect {
  const width = node.measured?.width ?? node.width ?? Number(node.style?.width ?? 0);
  const height = node.measured?.height ?? node.height ?? Number(node.style?.height ?? 0);
  const clearance = clearanceOverride ?? (node.type === 'boundary' ? 28 : 10);
  return {
    left: node.position.x - clearance,
    right: node.position.x + width + clearance,
    top: node.position.y - clearance,
    bottom: node.position.y + height + clearance,
  };
}

function segmentHitsRect(start: RoutePoint, end: RoutePoint, rect: RouteRect): boolean {
  if (start.x === end.x) {
    const low = Math.min(start.y, end.y);
    const high = Math.max(start.y, end.y);
    return start.x > rect.left && start.x < rect.right && high > rect.top && low < rect.bottom;
  }
  if (start.y === end.y) {
    const low = Math.min(start.x, end.x);
    const high = Math.max(start.x, end.x);
    return start.y > rect.top && start.y < rect.bottom && high > rect.left && low < rect.right;
  }
  return false;
}

function simplifyRoute(points: RoutePoint[]): RoutePoint[] {
  const unique = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  return unique.filter((point, index) => {
    if (!index || index === unique.length - 1) return true;
    const previous = unique[index - 1];
    const next = unique[index + 1];
    return !((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y));
  });
}

function roundedRoute(points: RoutePoint[], radius = 8): string {
  const route = simplifyRoute(points);
  if (route.length < 2) return '';
  let path = `M ${route[0].x},${route[0].y}`;
  for (let index = 1; index < route.length - 1; index += 1) {
    const previous = route[index - 1];
    const corner = route[index];
    const next = route[index + 1];
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
    const amount = Math.min(radius, incoming / 2, outgoing / 2);
    const before = {
      x: corner.x - Math.sign(corner.x - previous.x) * amount,
      y: corner.y - Math.sign(corner.y - previous.y) * amount,
    };
    const after = {
      x: corner.x + Math.sign(next.x - corner.x) * amount,
      y: corner.y + Math.sign(next.y - corner.y) * amount,
    };
    path += ` L ${before.x},${before.y} Q ${corner.x},${corner.y} ${after.x},${after.y}`;
  }
  const last = route[route.length - 1];
  return `${path} L ${last.x},${last.y}`;
}

function routeMidpoint(points: RoutePoint[]): RoutePoint {
  const route = simplifyRoute(points);
  const lengths = route.slice(1).map((point, index) => Math.hypot(point.x - route[index].x, point.y - route[index].y));
  const halfway = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let travelled = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    if (travelled + lengths[index] >= halfway) {
      const ratio = lengths[index] ? (halfway - travelled) / lengths[index] : 0;
      return {
        x: route[index].x + ((route[index + 1].x - route[index].x) * ratio),
        y: route[index].y + ((route[index + 1].y - route[index].y) * ratio),
      };
    }
    travelled += lengths[index];
  }
  return route.at(-1) ?? { x: 0, y: 0 };
}

function routeHits(points: RoutePoint[], obstacles: RouteRect[]): boolean {
  return points.slice(1).some((point, index) => obstacles.some((rect) => segmentHitsRect(points[index], point, rect)));
}

function gridRoute(source: RoutePoint, target: RoutePoint, obstacles: RouteRect[], nearby: RouteRect[]): RoutePoint[] | undefined {
  const xs = [...new Set([
    source.x,
    target.x,
    Math.min(source.x, target.x) - 64,
    Math.max(source.x, target.x) + 64,
    ...nearby.flatMap((rect) => [rect.left, rect.right]),
  ])].sort((left, right) => left - right);
  const ys = [...new Set([
    source.y,
    target.y,
    Math.min(source.y, target.y, ...nearby.map((rect) => rect.top)) - 24,
    Math.max(source.y, target.y, ...nearby.map((rect) => rect.bottom)) + 24,
    ...nearby.flatMap((rect) => [rect.top, rect.bottom]),
  ])].sort((left, right) => left - right);
  const sourceX = xs.indexOf(source.x);
  const sourceY = ys.indexOf(source.y);
  const targetX = xs.indexOf(target.x);
  const targetY = ys.indexOf(target.y);
  const insideObstacle = (point: RoutePoint) => obstacles.some((rect) => (
    point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom
  ));
  type SearchState = { x: number; y: number; direction: number; score: number; estimate: number; key: string };
  const keyFor = (x: number, y: number, direction: number) => `${x}:${y}:${direction}`;
  const startKey = keyFor(sourceX, sourceY, -1);
  const queue: SearchState[] = [{ x: sourceX, y: sourceY, direction: -1, score: 0, estimate: 0, key: startKey }];
  const scores = new Map([[startKey, 0]]);
  const previous = new Map<string, string>();
  const states = new Map<string, SearchState>([[startKey, queue[0]]]);
  const moves = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  let finalKey: string | undefined;

  while (queue.length) {
    queue.sort((left, right) => left.estimate - right.estimate);
    const current = queue.shift()!;
    if (current.score !== scores.get(current.key)) continue;
    if (current.x === targetX && current.y === targetY) {
      finalKey = current.key;
      break;
    }
    for (let direction = 0; direction < moves.length; direction += 1) {
      const [dx, dy] = moves[direction];
      const nextX = current.x + dx;
      const nextY = current.y + dy;
      if (nextX < 0 || nextX >= xs.length || nextY < 0 || nextY >= ys.length) continue;
      const from = { x: xs[current.x], y: ys[current.y] };
      const to = { x: xs[nextX], y: ys[nextY] };
      if (insideObstacle(to) || routeHits([from, to], obstacles)) continue;
      const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      const turnCost = current.direction >= 0 && current.direction !== direction ? 16 : 0;
      const score = current.score + distance + turnCost;
      const key = keyFor(nextX, nextY, direction);
      if (score >= (scores.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      const heuristic = Math.abs(to.x - target.x) + Math.abs(to.y - target.y);
      const state = { x: nextX, y: nextY, direction, score, estimate: score + heuristic, key };
      scores.set(key, score);
      states.set(key, state);
      previous.set(key, current.key);
      queue.push(state);
    }
  }
  if (!finalKey) return undefined;
  const route: RoutePoint[] = [];
  for (let key: string | undefined = finalKey; key; key = previous.get(key)) {
    const state = states.get(key)!;
    route.push({ x: xs[state.x], y: ys[state.y] });
  }
  return simplifyRoute(route.reverse());
}

function horizontalRoute(
  source: RoutePoint,
  target: RoutePoint,
  obstacles: RouteRect[],
  sourceLead = 20,
  targetLead = 20,
): RoutePoint[] {
  const gap = target.x - source.x;
  // Do not introduce a midpoint bend when exported geometry already aligns
  // the two handles. This is the common n8n Merge -> next-node shape.
  if (gap >= 0 && Math.abs(source.y - target.y) < 0.5) {
    const direct = [source, target];
    if (!routeHits(direct, obstacles)) return direct;
  }
  if (gap >= sourceLead + targetLead) {
    const centerX = source.x + (gap / 2);
    const direct = [source, { x: centerX, y: source.y }, { x: centerX, y: target.y }, target];
    if (!routeHits(direct, obstacles)) return direct;
  } else {
    const sourceExit = { x: source.x + 24, y: source.y };
    const targetEntry = { x: target.x - 24, y: target.y };
    const direct = [source, sourceExit, { x: sourceExit.x, y: target.y }, targetEntry, target];
    if (!routeHits(direct, obstacles)) return direct;
  }

  const minX = Math.min(source.x, target.x);
  const maxX = Math.max(source.x, target.x);
  const relevant = obstacles.filter((rect) => rect.right > minX && rect.left < maxX);
  // Backward and loop edges sometimes need to leave the source column before
  // travelling around a stack of nodes. Include nearby columns so the router
  // can choose an outside lane instead of falling back through the stack.
  const routingObstacles = obstacles.filter((rect) => rect.right > minX - 240 && rect.left < maxX + 240);
  const sourceExitX = source.x + Math.max(sourceLead, gap < 0 ? 24 : 0);
  const targetEntryX = target.x - Math.max(targetLead, gap < 0 ? 24 : 0);
  const preferredY = (source.y + target.y) / 2;
  const laneCandidates = [...new Set([
    Math.min(source.y, target.y) - 24,
    Math.max(source.y, target.y) + 24,
    ...routingObstacles.flatMap((rect) => [rect.top - 14, rect.bottom + 14]),
  ])].sort((left, right) => Math.abs(left - preferredY) - Math.abs(right - preferredY));
  const xCandidates = [...new Set([
    source.x,
    target.x,
    sourceExitX,
    targetEntryX,
    source.x - 48,
    source.x + 48,
    target.x - 48,
    target.x + 48,
    minX - 48,
    maxX + 48,
    ...routingObstacles.flatMap((rect) => [rect.left - 14, rect.right + 14]),
  ])];
  const nearSource = [...xCandidates]
    .filter((x) => x >= source.x + sourceLead - 0.5)
    .sort((left, right) => Math.abs(left - sourceExitX) - Math.abs(right - sourceExitX))
    .slice(0, 40);
  const nearTarget = [...xCandidates]
    .filter((x) => x <= target.x - targetLead + 0.5)
    .sort((left, right) => Math.abs(left - targetEntryX) - Math.abs(right - targetEntryX))
    .slice(0, 40);
  for (const laneY of laneCandidates.slice(0, 60)) {
    const clearSources = nearSource.filter((x) => !routeHits([source, { x, y: source.y }, { x, y: laneY }], obstacles));
    const clearTargets = nearTarget.filter((x) => !routeHits([{ x, y: laneY }, { x, y: target.y }, target], obstacles));
    const pairs = clearSources.flatMap((sourceX) => clearTargets.map((targetX) => ({ sourceX, targetX })))
      .sort((left, right) => Math.abs(left.sourceX - left.targetX) - Math.abs(right.sourceX - right.targetX));
    for (const { sourceX, targetX } of pairs) {
      const candidate = [source, { x: sourceX, y: source.y }, { x: sourceX, y: laneY }, { x: targetX, y: laneY }, { x: targetX, y: target.y }, target];
      if (!routeHits(candidate, obstacles)) return candidate;
    }
  }
  const searched = gridRoute({ x: sourceExitX, y: source.y }, { x: targetEntryX, y: target.y }, obstacles, routingObstacles);
  if (searched) {
    const candidate = [source, ...searched, target];
    if (!routeHits(candidate, obstacles)) return candidate;
  }
  const fallbackLane = Math.max(source.y, target.y, ...relevant.map((rect) => rect.bottom)) + 24;
  return [source, { x: sourceExitX, y: source.y }, { x: sourceExitX, y: fallbackLane }, { x: targetEntryX, y: fallbackLane }, { x: targetEntryX, y: target.y }, target];
}

function verticalRoute(source: RoutePoint, target: RoutePoint, obstacles: RouteRect[]): RoutePoint[] {
  const gap = target.y - source.y;
  if (gap >= 0) {
    const centerY = source.y + (gap / 2);
    const direct = [source, { x: source.x, y: centerY }, { x: target.x, y: centerY }, target];
    if (!routeHits(direct, obstacles)) return direct;
  } else {
    const sourceExit = { x: source.x, y: source.y + 24 };
    const targetEntry = { x: target.x, y: target.y - 24 };
    const direct = [source, sourceExit, { x: target.x, y: sourceExit.y }, targetEntry, target];
    if (!routeHits(direct, obstacles)) return direct;
  }

  const minY = Math.min(source.y, target.y);
  const maxY = Math.max(source.y, target.y);
  const relevant = obstacles.filter((rect) => rect.bottom > minY && rect.top < maxY);
  const sourceExitY = gap >= 0 ? source.y + Math.min(20, Math.max(4, gap / 3)) : source.y + 24;
  const targetEntryY = gap >= 0 ? target.y - Math.min(20, Math.max(4, gap / 3)) : target.y - 24;
  const firstLane = Math.max(source.x, target.x) + 24;
  const laneCandidates = [...new Set([firstLane, ...relevant.map((rect) => rect.right + 14).filter((lane) => lane >= firstLane)])].sort((left, right) => left - right);
  for (const laneX of laneCandidates) {
    const candidate = [
      source,
      { x: source.x, y: sourceExitY },
      { x: laneX, y: sourceExitY },
      { x: laneX, y: targetEntryY },
      { x: target.x, y: targetEntryY },
      target,
    ];
    if (!routeHits(candidate, obstacles)) return candidate;
  }
  const fallbackLane = Math.max(firstLane, ...relevant.map((rect) => rect.right + 24));
  return [source, { x: source.x, y: sourceExitY }, { x: fallbackLane, y: sourceExitY }, { x: fallbackLane, y: targetEntryY }, { x: target.x, y: targetEntryY }, target];
}

function N8nRoutedEdge(props: EdgeProps) {
  const allNodes = useNodes();
  const sourceNode = allNodes.find((node) => node.id === props.source);
  const targetNode = allNodes.find((node) => node.id === props.target);
  const source = { x: props.sourceX, y: props.sourceY };
  const target = { x: props.targetX, y: props.targetY };
  const obstacles = allNodes.flatMap((node) => {
    if (node.type === 'sticky') return [];
    const endpoint = node.id === props.source || node.id === props.target;
    if (endpoint && node.type !== 'boundary') return [];
    // Boundary endpoints retain the same clearance on every outer side. The
    // contacted side is opened below so the edge can leave the handle cleanly.
    const rect = nodeRect(node, endpoint && node.type !== 'boundary' ? 0 : undefined);
    // React Flow handle coordinates can differ from the measured boundary by
    // a fraction of a pixel. Keep the box interior solid while moving its
    // contact side just beyond the handle, otherwise the router can mistake a
    // valid horizontal departure for a collision and turn vertically at once.
    if (endpoint && node.type === 'boundary') {
      if (node.id === props.source) {
        if (props.sourcePosition === Position.Right) rect.right = source.x - 0.5;
        if (props.sourcePosition === Position.Left) rect.left = source.x + 0.5;
      }
      if (node.id === props.target) {
        if (props.targetPosition === Position.Left) rect.left = target.x + 0.5;
        if (props.targetPosition === Position.Right) rect.right = target.x - 0.5;
      }
    }
    if (node.type === 'boundary' && !endpoint) {
      const contains = (point: RoutePoint) => point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom;
      if (contains(source) && contains(target)) return [];
    }
    return [rect];
  });
  const fallback = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 8,
    offset: 20,
  });
  const supportsHorizontalRouting = props.sourcePosition === Position.Right && props.targetPosition === Position.Left;
  const supportsVerticalRouting = props.sourcePosition === Position.Bottom && props.targetPosition === Position.Top;
  const route = supportsHorizontalRouting
    ? horizontalRoute(source, target, obstacles, sourceNode?.type === 'boundary' ? 36 : 20, targetNode?.type === 'boundary' ? 36 : 20)
    : supportsVerticalRouting ? verticalRoute(source, target, obstacles) : undefined;
  const midpoint = route ? routeMidpoint(route) : { x: fallback[1], y: fallback[2] };
  const path = route ? roundedRoute(route) : fallback[0];
  return (
    <g data-route-source={props.source} data-route-target={props.target} data-route-source-position={props.sourcePosition} data-route-target-position={props.targetPosition}>
      <BaseEdge
        id={props.id}
        path={path}
        labelX={midpoint.x}
        labelY={midpoint.y}
        label={props.label}
        labelStyle={props.labelStyle}
        labelShowBg={props.labelShowBg}
        labelBgStyle={props.labelBgStyle}
        labelBgPadding={props.labelBgPadding}
        labelBgBorderRadius={props.labelBgBorderRadius}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        style={props.style}
        interactionWidth={props.interactionWidth}
      />
    </g>
  );
}

const edgeTypes = { routed: N8nRoutedEdge };

function ResetViewIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7a8 8 0 0 1 12.8-2.4L20 7M20 3v4h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15s3-4 8-4 8 4 8 4-3 4-8 4-8-4-8-4Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="15" r="1.8" fill="currentColor" />
    </svg>
  );
}

function ResetNodesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7a8 8 0 0 1 12.8-2.4L20 7M20 3v4h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="12" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="15" y="15" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 14.5h3a3 3 0 0 1 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function handlesFor(sceneNode: SceneNode, scene: GraphScene) {
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  for (const edge of scene.edges) {
    if (edge.target === sceneNode.id) inputs.add(edge.targetHandle ?? `in:${edge.connectionType}:${edge.inputIndex}`);
    if (edge.source === sceneNode.id) outputs.add(edge.sourceHandle ?? `out:${edge.connectionType}:${edge.outputIndex}`);
  }
  if (sceneNode.kind === 'workflow') {
    for (let index = 0; index < Number(sceneNode.data.inputCount ?? 0); index += 1) inputs.add(`in:main:${index}`);
    for (let index = 0; index < Number(sceneNode.data.outputCount ?? 0); index += 1) outputs.add(`out:main:${index}`);
  }
  if (sceneNode.kind === 'port') {
    if (!inputs.size) inputs.add('in:main:0');
    if (!outputs.size) outputs.add('out:main:0');
  }
  const byConnectionAndIndex = (left: string, right: string) => {
    const [, leftType, leftIndex] = left.split(':');
    const [, rightType, rightIndex] = right.split(':');
    return leftType.localeCompare(rightType) || Number(leftIndex) - Number(rightIndex);
  };
  const inputHandles = [...inputs].sort(byConnectionAndIndex);
  const outputHandles = [...outputs].sort(byConnectionAndIndex);
  const nodeType = String(sceneNode.data.nodeType ?? '').toLowerCase();
  const inputLabels: Record<string, string> = {};
  const outputLabels: Record<string, string> = {};
  if (nodeType.endsWith('.merge')) {
    inputHandles.filter((handle) => handle.startsWith('in:main:')).forEach((handle) => {
      inputLabels[handle] = `Input ${Number(handle.split(':')[2]) + 1}`;
    });
  }
  if (nodeType.endsWith('.if')) {
    outputLabels['out:main:0'] = 'true';
    outputLabels['out:main:1'] = 'false';
  }
  return { inputHandles, outputHandles, inputLabels, outputLabels };
}

const GraphCanvasInner = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  ({
    scene,
    onTogglePath,
    onNodeActivate,
    highlightMissing = false,
    activeNodeIds = EMPTY_IDS,
    activeEdgeIds = EMPTY_IDS,
    executedCounts = EMPTY_COUNTS,
    executedEdgeIds = EMPTY_IDS,
    checkpointIds = EMPTY_IDS,
    conflictGroups = [],
    showConflicts = false,
    followActive = false,
    followNodeId,
    followLookaheadNodeId,
  }, ref) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const offsetsRef = useRef(new Map<string, { x: number; y: number }>());
  const basePositionsRef = useRef(new Map<string, { x: number; y: number }>());
  const boundaryDragRef = useRef<{ id: string; last: { x: number; y: number }; children: Set<string> }>();
  const suppressClickUntilRef = useRef(0);
  const userViewportInteractionRef = useRef(false);
  const preparedNodes = useMemo<CanvasNode[]>(() => scene.nodes.filter((node) => !node.data.simulationOnly).map((node) => {
    basePositionsRef.current.set(node.id, { x: node.x, y: node.y });
    const offset = offsetsRef.current.get(node.id) ?? { x: 0, y: 0 };
    return {
    id: node.id,
    type: node.kind,
    position: { x: node.x + offset.x, y: node.y + offset.y },
    draggable: node.kind !== 'sticky',
    selectable: true,
    style: { width: node.width, height: node.height, zIndex: node.zIndex },
    data: {
      ...node.data,
      ...handlesFor(node, scene),
      onToggle: onTogglePath,
      isSimulationActive: activeNodeIds.has(node.id),
      isSimulationExecuted: executedCounts.has(node.id),
      executionCount: executedCounts.get(node.id) ?? 0,
      isCheckpoint: checkpointIds.has(node.id),
      isConflict: showConflicts && conflictGroups.some((group) => group.nodeIds.includes(node.id)),
      conflictNumbers: showConflicts ? conflictGroups.flatMap((group, index) => group.nodeIds.includes(node.id) ? [index + 1] : []) : [],
    },
  };
  }), [scene, onTogglePath, activeNodeIds, executedCounts, checkpointIds, conflictGroups, showConflicts]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(preparedNodes);
  const nodesRef = useRef(nodes);
  const followNodeIdRef = useRef(followNodeId);
  const followLookaheadNodeIdRef = useRef(followLookaheadNodeId);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { followNodeIdRef.current = followNodeId; }, [followNodeId]);
  useEffect(() => { followLookaheadNodeIdRef.current = followLookaheadNodeId; }, [followLookaheadNodeId]);
  useEffect(() => {
    setNodes((current) => {
      const existing = new Map(current.map((node) => [node.id, node]));
      return preparedNodes.map((node) => {
        const previous = existing.get(node.id);
        if (!previous) return node;
        // Preserve React Flow's asynchronous measurements when visual state
        // changes. Replacing a measured node with a fresh object can strand its
        // edges until ResizeObserver fires again (not guaranteed when the size
        // itself did not change).
        return { ...node, measured: previous.measured, selected: previous.selected };
      });
    });
    const frame = window.requestAnimationFrame(() => updateNodeInternals(preparedNodes.map((node) => node.id)));
    return () => window.cancelAnimationFrame(frame);
  }, [preparedNodes, setNodes, updateNodeInternals]);

  useEffect(() => {
    if (!instance) return undefined;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        void instance.fitView({ padding: 0.12, duration: 250, minZoom: 0.02 });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [instance, scene]);

  useEffect(() => {
    if (!followActive || !instance || !stageRef.current) return undefined;
    let frame = 0;
    let previous = performance.now();
    let velocityX = 0;
    let velocityY = 0;
    const tick = (now: number) => {
      const elapsed = Math.max(1, Math.min(40, now - previous));
      previous = now;
      const targetId = followNodeIdRef.current;
      const target = targetId ? nodesRef.current.find((node) => node.id === targetId) : undefined;
      if (!userViewportInteractionRef.current && target && stageRef.current) {
        const viewport = instance.getViewport();
        const stage = stageRef.current.getBoundingClientRect();
        const boundsFor = (node: CanvasNode) => {
          const width = Number(node.measured?.width ?? node.width ?? node.style?.width ?? 0);
          const height = Number(node.measured?.height ?? node.height ?? node.style?.height ?? 0);
          return {
            left: node.position.x * viewport.zoom + viewport.x,
            right: (node.position.x + width) * viewport.zoom + viewport.x,
            top: node.position.y * viewport.zoom + viewport.y,
            bottom: (node.position.y + height) * viewport.zoom + viewport.y,
          };
        };
        const bounds = boundsFor(target);
        // The field always occupies the central 50% of the live viewport. Its
        // flow-space size therefore updates immediately whenever zoom changes.
        const safe = { left: stage.width * 0.25, right: stage.width * 0.75, top: stage.height * 0.25, bottom: stage.height * 0.75 };
        let dx = bounds.left < safe.left ? safe.left - bounds.left : bounds.right > safe.right ? safe.right - bounds.right : 0;
        let dy = bounds.top < safe.top ? safe.top - bounds.top : bounds.bottom > safe.bottom ? safe.bottom - bounds.bottom : 0;

        // When the current node is already comfortable, begin moving toward
        // the next step without pushing the current node out of a wider guard.
        // This reduces catch-up distance while keeping the active step visible.
        if (!dx && !dy) {
          const lookaheadId = followLookaheadNodeIdRef.current;
          const lookahead = lookaheadId && lookaheadId !== target.id
            ? nodesRef.current.find((node) => node.id === lookaheadId)
            : undefined;
          if (lookahead) {
            const nextBounds = boundsFor(lookahead);
            const wantedX = nextBounds.left < safe.left ? safe.left - nextBounds.left : nextBounds.right > safe.right ? safe.right - nextBounds.right : 0;
            const wantedY = nextBounds.top < safe.top ? safe.top - nextBounds.top : nextBounds.bottom > safe.bottom ? safe.bottom - nextBounds.bottom : 0;
            const guard = { left: stage.width * 0.125, right: stage.width * 0.875, top: stage.height * 0.125, bottom: stage.height * 0.875 };
            const minX = guard.left - bounds.left;
            const maxX = guard.right - bounds.right;
            const minY = guard.top - bounds.top;
            const maxY = guard.bottom - bounds.bottom;
            dx = minX <= maxX ? Math.max(minX, Math.min(maxX, wantedX)) : 0;
            dy = minY <= maxY ? Math.max(minY, Math.min(maxY, wantedY)) : 0;
          }
        }

        const distance = Math.hypot(dx, dy);
        const maximumSpeed = Math.min(2_400, 760 + distance * 1.9);
        const deceleration = 6_500;
        const brakingSpeed = Math.sqrt(2 * deceleration * distance);
        const desiredSpeed = Math.min(maximumSpeed, distance * 5.4, brakingSpeed);
        const desiredVelocityX = distance ? dx / distance * desiredSpeed : 0;
        const desiredVelocityY = distance ? dy / distance * desiredSpeed : 0;
        const acceleration = Math.min(14_000, 5_000 + distance * 8);
        const approach = (current: number, desired: number) => {
          const limit = (Math.abs(desired) > Math.abs(current) ? acceleration : deceleration) * elapsed / 1_000;
          return current + Math.max(-limit, Math.min(limit, desired - current));
        };
        velocityX = approach(velocityX, desiredVelocityX);
        velocityY = approach(velocityY, desiredVelocityY);
        let moveX = velocityX * elapsed / 1000;
        let moveY = velocityY * elapsed / 1000;
        if (dx && Math.sign(moveX) === Math.sign(dx) && Math.abs(moveX) > Math.abs(dx)) moveX = dx;
        if (dy && Math.sign(moveY) === Math.sign(dy) && Math.abs(moveY) > Math.abs(dy)) moveY = dy;
        if (Math.abs(moveX) > 0.02 || Math.abs(moveY) > 0.02) {
          // Read and write the current zoom in the same frame: Follow changes
          // translation only and never restores a stale zoom value.
          void instance.setViewport({ x: viewport.x + moveX, y: viewport.y + moveY, zoom: viewport.zoom });
        }
      } else {
        velocityX = 0;
        velocityY = 0;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [followActive, instance]);

  const rememberPositions = useCallback((items: CanvasNode[]) => {
    items.forEach((node) => {
      const base = basePositionsRef.current.get(node.id);
      if (base) offsetsRef.current.set(node.id, { x: node.position.x - base.x, y: node.position.y - base.y });
    });
  }, []);

  const handleNodeDragStart = useCallback((_event: MouseEvent | TouchEvent, node: CanvasNode) => {
    if (node.type !== 'boundary') return;
    const width = Number(node.style?.width ?? node.measured?.width ?? 0);
    const height = Number(node.style?.height ?? node.measured?.height ?? 0);
    const children = new Set(nodes.filter((candidate) => candidate.id !== node.id
      && candidate.position.x >= node.position.x
      && candidate.position.y >= node.position.y
      && candidate.position.x + Number(candidate.style?.width ?? candidate.measured?.width ?? 0) <= node.position.x + width
      && candidate.position.y + Number(candidate.style?.height ?? candidate.measured?.height ?? 0) <= node.position.y + height).map((candidate) => candidate.id));
    boundaryDragRef.current = { id: node.id, last: { ...node.position }, children };
  }, [nodes]);

  const handleNodeDrag = useCallback((_event: MouseEvent | TouchEvent, node: CanvasNode) => {
    const group = boundaryDragRef.current;
    if (!group || group.id !== node.id) return;
    const dx = node.position.x - group.last.x;
    const dy = node.position.y - group.last.y;
    if (!dx && !dy) return;
    setNodes((current) => {
      const moved = current.map((candidate) => group.children.has(candidate.id)
        ? { ...candidate, position: { x: candidate.position.x + dx, y: candidate.position.y + dy } }
        : candidate);
      rememberPositions(moved.filter((candidate) => group.children.has(candidate.id)));
      return moved;
    });
    group.last = { ...node.position };
  }, [rememberPositions, setNodes]);

  const handleNodeDragStop = useCallback(() => {
    rememberPositions(nodes);
    boundaryDragRef.current = undefined;
    suppressClickUntilRef.current = Date.now() + 220;
  }, [nodes, rememberPositions]);
  const edges = useMemo<Edge[]>(() => scene.edges.filter((edge) => !edge.hidden).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label,
    type: 'routed',
    markerEnd: { type: MarkerType.ArrowClosed, color: connectionColor(edge.connectionType), width: 10, height: 10 },
    style: {
      ...edge.style,
      '--conflict-color': conflictColors[Math.max(0, conflictGroups.findIndex((group) => group.edgeIds.includes(edge.id))) % conflictColors.length],
    } as React.CSSProperties,
    animated: edge.connectionType !== 'main' && !edge.inactive,
    className: [edge.inactive ? 'inactive-edge' : '', executedEdgeIds.has(edge.id) ? 'is-simulation-executed-edge' : '', activeEdgeIds.has(edge.id) ? 'is-simulation-active-edge' : '', showConflicts && conflictGroups.some((group) => group.edgeIds.includes(edge.id)) ? 'is-conflict-edge' : ''].filter(Boolean).join(' ') || undefined,
    data: { conflictNumber: showConflicts ? conflictGroups.findIndex((group) => group.edgeIds.includes(edge.id)) + 1 : 0 },
    hidden: edge.hidden,
  })), [scene, executedEdgeIds, activeEdgeIds, conflictGroups, showConflicts]);

  const resetNodeLocations = useCallback(() => {
    offsetsRef.current.clear();
    setNodes((current) => current.map((node) => {
      const base = basePositionsRef.current.get(node.id);
      return base ? { ...node, position: { ...base } } : node;
    }));
    window.requestAnimationFrame(() => {
      updateNodeInternals(nodes.map((node) => node.id));
      void instance?.fitView({ padding: 0.12, duration: 250, minZoom: 0.02 });
    });
  }, [instance, nodes, setNodes, updateNodeInternals]);

  useImperativeHandle(ref, () => ({
    fit: () => void instance?.fitView({ padding: 0.12, duration: 250, minZoom: 0.02 }),
    getStage: () => stageRef.current,
    export: async (format, workflowName, viewName) => {
      if (!instance || !stageRef.current) throw new Error('The graph is not ready yet.');
      await exportGraphStage(stageRef.current, instance, format, workflowName, viewName);
    },
  }), [instance]);

  return (
    <div className={`graph-stage ${highlightMissing ? 'highlight-missing' : ''}`} ref={stageRef} data-testid="graph-stage">
      <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={setInstance}
          onMoveStart={(event) => { if (event) userViewportInteractionRef.current = true; }}
          onMoveEnd={() => { userViewportInteractionRef.current = false; }}
          onNodeDragStart={handleNodeDragStart}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={(_event, node) => {
            if (Date.now() < suppressClickUntilRef.current) return;
            if (typeof node.data.instancePath === 'string' && (node.type === 'boundary' || node.data.status === 'collapsed')) {
              onTogglePath?.(node.data.instancePath);
              return;
            }
            onNodeActivate?.(node.id);
          }}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          selectionOnDrag
          panOnDrag={[1, 2]}
          multiSelectionKeyCode="Control"
          fitView
          fitViewOptions={{ padding: 0.12, minZoom: 0.02 }}
          minZoom={0.02}
          maxZoom={3}
          colorMode="dark"
          proOptions={{ hideAttribution: false }}
      >
        <Background color="#303034" gap={16} size={1} />
        <Controls showInteractive={false} showFitView={false}>
          <ControlButton title="Reset view" aria-label="Reset view" onClick={() => instance?.fitView({ padding: 0.12, duration: 250, minZoom: 0.02 })}>
            <ResetViewIcon />
          </ControlButton>
          <ControlButton title="Reset node locations" aria-label="Reset node locations" onClick={resetNodeLocations}>
            <ResetNodesIcon />
          </ControlButton>
        </Controls>
      </ReactFlow>
    </div>
  );
});

GraphCanvasInner.displayName = 'GraphCanvas';

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>((props, ref) => (
  <ReactFlowProvider><GraphCanvasInner {...props} ref={ref} /></ReactFlowProvider>
));

GraphCanvas.displayName = 'GraphCanvasProvider';
