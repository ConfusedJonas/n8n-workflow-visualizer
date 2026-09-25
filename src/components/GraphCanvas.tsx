import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodes,
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
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { GraphScene, SceneNode } from '../renderers/scene';
import { connectionColor } from '../renderers/scene';
import { exportGraphStage, type ExportFormat } from '../export/exportDiagram';

interface CanvasNodeData extends Record<string, unknown> {
  label?: string;
  nodeType?: string;
  detail?: string;
  inputCount?: number;
  outputCount?: number;
  disabled?: boolean;
  content?: string;
  color?: number;
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
}

type CanvasNode = Node<CanvasNodeData>;

export interface GraphCanvasHandle {
  fit(): void;
  export(format: ExportFormat, workflowName: string, viewName: string): Promise<void>;
}

interface GraphCanvasProps {
  scene: GraphScene;
  onTogglePath?: (path: string) => void;
}

const stickyColors = ['#fff0a6', '#a9d7ff', '#b8f2cf', '#ffc8df', '#d7c2ff', '#ffd1a8', '#b8efe9'];

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
type CoreGlyph = 'aggregate' | 'execute' | 'if' | 'manual' | 'merge';

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
  if (normalized.includes('http')) return { lucide: Globe2, color: '#4aa7f5', shape: 'square' };
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
  const Icon = appearance.lucide ?? CircleHelp;
  const style = { '--node-accent': appearance.color } as React.CSSProperties;
  return (
    <div className={`canvas-node ${data.disabled ? 'is-disabled' : ''}`} style={style}>
      <div className={`node-tile shape-${appearance.shape}`}>
        <Handles data={data} />
        <span className="node-symbol">
          {appearance.brand ? <BrandIcon icon={appearance.brand} /> : appearance.core ? <CoreIcon glyph={appearance.core} /> : <Icon size={40} strokeWidth={1.7} />}
        </span>
      </div>
      <span className="node-copy" title={String(data.label ?? 'Unnamed node')}>
        <strong>{String(data.label ?? 'Unnamed node')}</strong>
        {data.detail ? <small>{String(data.detail)}</small> : null}
      </span>
      {data.disabled ? <span className="node-badge">Disabled</span> : null}
    </div>
  );
}

function safeHref(href?: string): string | undefined {
  if (!href) return undefined;
  return /^(https?:|mailto:)/i.test(href) ? href : undefined;
}

function StickyNode({ data }: NodeProps<CanvasNode>) {
  const color = stickyColors[Math.abs(Number(data.color ?? 0)) % stickyColors.length];
  return (
    <article className="sticky-note" style={{ background: color }}>
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
  const expandable = data.status === 'collapsed' && typeof data.instancePath === 'string';
  return (
    <div className={`placeholder-card status-${String(data.status ?? 'unknown')}`}>
      <Handles data={data} />
      <CircleHelp size={20} />
      <span><strong>{String(data.label ?? 'Unresolved workflow')}</strong><small>{String(data.status ?? 'unknown')}</small></span>
      {expandable ? <button type="button" onClick={() => data.onToggle?.(String(data.instancePath))}>Expand</button> : null}
    </div>
  );
}

function BoundaryNode({ data }: NodeProps<CanvasNode>) {
  return (
    <section className="workflow-boundary">
      <header>
        <span><Layers3 size={16} /> {String(data.label ?? 'Sub-workflow')}</span>
        {typeof data.instancePath === 'string' ? (
          <button type="button" onClick={() => data.onToggle?.(String(data.instancePath))}>Collapse</button>
        ) : null}
      </header>
    </section>
  );
}

function PortNode({ data }: NodeProps<CanvasNode>) {
  return (
    <div className={`boundary-port status-${String(data.status ?? '')}`} title={String(data.label ?? '')}>
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

function nodeRect(node: Node): RouteRect {
  const width = node.measured?.width ?? node.width ?? Number(node.style?.width ?? 0);
  const height = node.measured?.height ?? node.height ?? Number(node.style?.height ?? 0);
  return {
    left: node.position.x - 10,
    right: node.position.x + width + 10,
    top: node.position.y - 10,
    bottom: node.position.y + height + 10,
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

function horizontalRoute(source: RoutePoint, target: RoutePoint, obstacles: RouteRect[]): RoutePoint[] {
  const gap = target.x - source.x;
  // Do not introduce a midpoint bend when exported geometry already aligns
  // the two handles. This is the common n8n Merge -> next-node shape.
  if (gap >= 0 && Math.abs(source.y - target.y) < 0.5) {
    const direct = [source, target];
    if (!routeHits(direct, obstacles)) return direct;
  }
  if (gap >= 0) {
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
  const sourceExitX = gap >= 0 ? source.x + Math.min(20, Math.max(4, gap / 3)) : source.x + 24;
  const targetEntryX = gap >= 0 ? target.x - Math.min(20, Math.max(4, gap / 3)) : target.x - 24;
  const firstLane = Math.max(source.y, target.y) + 24;
  const laneCandidates = [...new Set([firstLane, ...relevant.map((rect) => rect.bottom + 14).filter((lane) => lane >= firstLane)])].sort((left, right) => left - right);
  for (const laneY of laneCandidates) {
    const candidate = [
      source,
      { x: sourceExitX, y: source.y },
      { x: sourceExitX, y: laneY },
      { x: targetEntryX, y: laneY },
      { x: targetEntryX, y: target.y },
      target,
    ];
    if (!routeHits(candidate, obstacles)) return candidate;
  }
  const fallbackLane = Math.max(firstLane, ...relevant.map((rect) => rect.bottom + 24));
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
  const obstacles = allNodes
    .filter((node) => node.type !== 'boundary' && node.id !== props.source && node.id !== props.target)
    .map(nodeRect);
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
  const source = { x: props.sourceX, y: props.sourceY };
  const target = { x: props.targetX, y: props.targetY };
  const route = supportsHorizontalRouting
    ? horizontalRoute(source, target, obstacles)
    : supportsVerticalRouting ? verticalRoute(source, target, obstacles) : undefined;
  const midpoint = route ? routeMidpoint(route) : { x: fallback[1], y: fallback[2] };
  const path = route ? roundedRoute(route) : fallback[0];
  return (
    <g data-route-source={props.source} data-route-target={props.target}>
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

const GraphCanvasInner = forwardRef<GraphCanvasHandle, GraphCanvasProps>(({ scene, onTogglePath }, ref) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const nodes = useMemo<CanvasNode[]>(() => scene.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { x: node.x, y: node.y },
    draggable: false,
    selectable: node.kind !== 'boundary',
    style: { width: node.width, height: node.height, zIndex: node.zIndex },
    data: { ...node.data, ...handlesFor(node, scene), onToggle: onTogglePath },
  })), [scene, onTogglePath]);
  const edges = useMemo<Edge[]>(() => scene.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label,
    type: 'routed',
    markerEnd: { type: MarkerType.ArrowClosed, color: connectionColor(edge.connectionType), width: 10, height: 10 },
    style: edge.style,
    animated: edge.connectionType !== 'main' && !edge.inactive,
    className: edge.inactive ? 'inactive-edge' : undefined,
  })), [scene]);

  useImperativeHandle(ref, () => ({
    fit: () => void instance?.fitView({ padding: 0.12, duration: 250, minZoom: 0.02 }),
    export: async (format, workflowName, viewName) => {
      if (!instance || !stageRef.current) throw new Error('The graph is not ready yet.');
      await exportGraphStage(stageRef.current, instance, format, workflowName, viewName);
    },
  }), [instance]);

  return (
    <div className="graph-stage" ref={stageRef} data-testid="graph-stage">
      <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={setInstance}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.12, minZoom: 0.02 }}
          minZoom={0.02}
          maxZoom={3}
          colorMode="dark"
          proOptions={{ hideAttribution: false }}
      >
        <Background color="#303034" gap={16} size={1} />
        <MiniMap pannable zoomable nodeColor={(node) => node.type === 'sticky' ? '#786f3d' : node.type === 'boundary' ? '#2d2940' : '#5b5c68'} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
});

GraphCanvasInner.displayName = 'GraphCanvas';

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>((props, ref) => (
  <ReactFlowProvider><GraphCanvasInner {...props} ref={ref} /></ReactFlowProvider>
));

GraphCanvas.displayName = 'GraphCanvasProvider';
