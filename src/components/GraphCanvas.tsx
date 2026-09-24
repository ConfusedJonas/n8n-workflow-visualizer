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
import { SmartEdgeProvider, SmartSmoothStepEdge } from '@tisoap/react-flow-smart-edge';
import {
  Bot,
  Braces,
  CircleHelp,
  Clock3,
  Code2,
  GitBranch,
  GitMerge,
  Globe2,
  Layers3,
  ListTree,
  MousePointerClick,
  Sigma,
  Split,
  TableProperties,
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
  operation?: string;
  resource?: string;
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

type NodeShape = 'square' | 'rounded' | 'circle';

interface NodeAppearance {
  color: string;
  shape: NodeShape;
  lucide?: typeof CircleHelp;
  brand?: SimpleIcon;
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
  if (normalized.includes('manualtrigger')) return { lucide: MousePointerClick, color: '#ff6d5a', shape: 'rounded' };
  if (normalized.includes('trigger') || normalized.includes('webhook')) return { lucide: normalized.includes('webhook') ? Globe2 : MousePointerClick, color: '#ff6d5a', shape: 'rounded' };
  if (normalized.includes('execute') || normalized.includes('workflow')) return { lucide: Workflow, color: '#ff6d5a', shape: 'square' };
  if (normalized.includes('http')) return { lucide: Globe2, color: '#4aa7f5', shape: 'square' };
  if (normalized.includes('code') || normalized.includes('function')) return { lucide: Code2, color: '#ffb454', shape: 'square' };
  if (normalized.endsWith('.if') || normalized.includes('switch')) return { lucide: GitBranch, color: '#8f93a2', shape: 'square' };
  if (normalized.includes('merge')) return { lucide: GitMerge, color: '#4cc38a', shape: 'square' };
  if (normalized.includes('splitout') || normalized.includes('splitinbatches')) return { lucide: Split, color: '#56b6c2', shape: 'square' };
  if (normalized.includes('aggregate')) return { lucide: Sigma, color: '#c678dd', shape: 'square' };
  if (normalized.includes('itemlists')) return { lucide: ListTree, color: '#56b6c2', shape: 'square' };
  if (normalized.includes('schedule') || normalized.includes('cron')) return { lucide: Clock3, color: '#ffb454', shape: 'rounded' };
  if (normalized.includes('set') || normalized.includes('editfields')) return { lucide: TableProperties, color: '#4aa7f5', shape: 'square' };
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

function WorkflowNode({ data }: NodeProps<CanvasNode>) {
  const appearance = appearanceFor(data.nodeType);
  const Icon = appearance.lucide ?? CircleHelp;
  const operation = [data.resource, data.operation].filter(Boolean).join(' · ');
  const style = { '--node-accent': appearance.color } as React.CSSProperties;
  return (
    <div className={`canvas-node ${data.disabled ? 'is-disabled' : ''}`} style={style}>
      <div className={`node-tile shape-${appearance.shape}`}>
        <Handles data={data} />
        <span className="node-symbol">
          {appearance.brand ? <BrandIcon icon={appearance.brand} /> : <Icon size={27} strokeWidth={1.8} />}
        </span>
      </div>
      <span className="node-copy" title={String(data.label ?? 'Unnamed node')}>
        <strong>{String(data.label ?? 'Unnamed node')}</strong>
        {operation ? <small>{operation}</small> : null}
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
  // Expanded workflow boundaries are visual containers, not obstacles. Their
  // children occupy the same rectangle and remain the real routing obstacles.
  const routingNodes = useMemo(() => nodes.filter((node) => node.type !== 'boundary'), [nodes]);
  const edges = useMemo<Edge[]>(() => scene.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label,
    type: 'smart',
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
      <SmartEdgeProvider nodes={routingNodes} options={{ preset: 'smoothstep', gridRatio: 8, nodePadding: 12, borderRadius: 8, routeOnlyWhenBlocked: false }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={{ smart: SmartSmoothStepEdge }}
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
      </SmartEdgeProvider>
    </div>
  );
});

GraphCanvasInner.displayName = 'GraphCanvas';

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>((props, ref) => (
  <ReactFlowProvider><GraphCanvasInner {...props} ref={ref} /></ReactFlowProvider>
));

GraphCanvas.displayName = 'GraphCanvasProvider';
