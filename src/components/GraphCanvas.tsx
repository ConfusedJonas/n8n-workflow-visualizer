import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  Bot,
  Braces,
  CircleHelp,
  Clock3,
  Code2,
  Database,
  GitBranch,
  Globe2,
  Layers3,
  Merge,
  MousePointerClick,
  Workflow,
  Wrench,
} from 'lucide-react';
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

function handleStyle(handle: string, index: number, total: number): React.CSSProperties {
  const [, type] = handle.split(':');
  if (type !== 'main') {
    return { left: `${((index + 1) / (total + 1)) * 100}%`, background: connectionColor(type) };
  }
  return { top: `${((index + 1) / (total + 1)) * 100}%`, background: connectionColor(type) };
}

function Handles({ data }: { data: CanvasNodeData }) {
  const inputs = data.inputHandles ?? [];
  const outputs = data.outputHandles ?? [];
  return (
    <>
      {inputs.map((id, index) => {
        const ai = id.split(':')[1] !== 'main';
        return <Handle key={id} id={id} type="target" position={ai ? Position.Top : Position.Left} style={handleStyle(id, index, inputs.length)} />;
      })}
      {outputs.map((id, index) => {
        const ai = id.split(':')[1] !== 'main';
        return <Handle key={id} id={id} type="source" position={ai ? Position.Bottom : Position.Right} style={handleStyle(id, index, outputs.length)} />;
      })}
    </>
  );
}

function iconFor(type = '') {
  const normalized = type.toLowerCase();
  if (normalized.includes('execute') || normalized.includes('workflow')) return Workflow;
  if (normalized.includes('database') || normalized.includes('postgres') || normalized.includes('mysql')) return Database;
  if (normalized.includes('http') || normalized.includes('webhook')) return Globe2;
  if (normalized.includes('code') || normalized.includes('function')) return Code2;
  if (normalized.includes('if') || normalized.includes('switch')) return GitBranch;
  if (normalized.includes('merge')) return Merge;
  if (normalized.includes('schedule') || normalized.includes('cron')) return Clock3;
  if (normalized.includes('trigger')) return MousePointerClick;
  if (normalized.includes('agent') || normalized.includes('openai') || normalized.includes('model')) return Bot;
  if (normalized.includes('tool')) return Wrench;
  if (normalized.includes('set') || normalized.includes('editfields')) return Braces;
  return CircleHelp;
}

function WorkflowNode({ data }: NodeProps<CanvasNode>) {
  const Icon = iconFor(data.nodeType);
  return (
    <div className={`node-card ${data.disabled ? 'is-disabled' : ''}`}>
      <Handles data={data} />
      <span className="node-icon"><Icon size={22} /></span>
      <span className="node-copy">
        <strong>{String(data.label ?? 'Unnamed node')}</strong>
        <small>{String(data.nodeType ?? 'Unknown node type').replace(/^.*\./, '')}</small>
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

function handlesFor(sceneNode: SceneNode, scene: GraphScene) {
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  for (const edge of scene.edges) {
    if (edge.target === sceneNode.id) inputs.add(edge.targetHandle ?? `in:${edge.connectionType}:${edge.inputIndex}`);
    if (edge.source === sceneNode.id) outputs.add(edge.sourceHandle ?? `out:${edge.connectionType}:${edge.outputIndex}`);
  }
  if (sceneNode.kind === 'port') {
    if (!inputs.size) inputs.add('in:main:0');
    if (!outputs.size) outputs.add('out:main:0');
  }
  return { inputHandles: [...inputs].sort(), outputHandles: [...outputs].sort() };
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
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: connectionColor(edge.connectionType), width: 14, height: 14 },
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
        <Background color="#32323c" gap={24} size={1} />
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
