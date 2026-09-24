import type {
  JsonRecord,
  NormalizedWorkflow,
  ParseDiagnostic,
  ParseDocumentResult,
  StickyNote,
  SubworkflowReference,
  SubworkflowSourceMode,
  WorkflowEdge,
  WorkflowNode,
} from './types';

export const PARSER_VERSION = 1;
const STICKY_NOTE_TYPE = 'n8n-nodes-base.stickyNote';
const EXECUTE_WORKFLOW_TYPE = 'n8n-nodes-base.executeWorkflow';

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function stableHash(value: unknown): string {
  const text = stableStringify(value);
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

function diagnostic(
  diagnostics: ParseDiagnostic[],
  severity: 'warning' | 'error',
  code: string,
  message: string,
  path?: string,
): void {
  diagnostics.push({ severity, code, message, path });
}

function fallbackPosition(index: number) {
  return { x: (index % 5) * 240, y: Math.floor(index / 5) * 150 };
}

function normalizePosition(value: unknown, index: number, diagnostics: ParseDiagnostic[], path: string) {
  if (Array.isArray(value)) {
    const x = finiteNumber(value[0]);
    const y = finiteNumber(value[1]);
    if (x !== undefined && y !== undefined) return { x, y };
  }
  diagnostic(diagnostics, 'warning', 'node.position.fallback', 'Node position is missing or invalid; a stable fallback was used.', path);
  return fallbackPosition(index);
}

function isNodeType(type: string, expected: string): boolean {
  return type === expected || type.endsWith(`.${expected.split('.').at(-1)}`);
}

function normalizeNode(
  raw: unknown,
  index: number,
  workflowKey: string,
  diagnostics: ParseDiagnostic[],
): WorkflowNode | StickyNote | undefined {
  const path = `nodes[${index}]`;
  if (!isRecord(raw)) {
    diagnostic(diagnostics, 'warning', 'node.invalid', 'Non-object node was skipped.', path);
    return undefined;
  }

  const name = stringValue(raw.name) ?? `Unnamed node ${index + 1}`;
  const type = stringValue(raw.type) ?? 'unknown';
  const id = stringValue(raw.id) ?? `generated-${stableHash([workflowKey, name, index])}`;
  const position = normalizePosition(raw.position, index, diagnostics, `${path}.position`);
  const parameters = isRecord(raw.parameters) ? raw.parameters : {};

  if (!stringValue(raw.name)) {
    diagnostic(diagnostics, 'warning', 'node.name.fallback', `A generated name was used for node ${index + 1}.`, `${path}.name`);
  }
  if (!stringValue(raw.type)) {
    diagnostic(diagnostics, 'warning', 'node.type.unknown', `Node "${name}" has no type and will use the generic renderer.`, `${path}.type`);
  }
  if (!stringValue(raw.id)) {
    diagnostic(diagnostics, 'warning', 'node.id.generated', `Node "${name}" has no ID; a stable local ID was generated.`, `${path}.id`);
  }

  if (isNodeType(type, STICKY_NOTE_TYPE)) {
    return {
      id,
      name,
      position,
      width: finiteNumber(parameters.width) ?? 240,
      height: finiteNumber(parameters.height) ?? 160,
      color: finiteNumber(parameters.color) ?? 1,
      content: typeof parameters.content === 'string' ? parameters.content : '',
      raw,
    };
  }

  return {
    id,
    name,
    type,
    typeVersion: finiteNumber(raw.typeVersion),
    position,
    disabled: raw.disabled === true,
    parameters,
    raw,
    sourceIndex: index,
  };
}

function isExpression(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith('=') ||
    trimmed.includes('{{') ||
    trimmed.includes('${') ||
    trimmed === 'undefined' ||
    trimmed === 'null'
  );
}

function resourceLocatorValue(value: unknown): { value?: string; label?: string } {
  if (typeof value === 'string') return { value };
  if (!isRecord(value)) return {};
  return {
    value: stringValue(value.value),
    label: stringValue(value.cachedResultName),
  };
}

function normalizeSourceMode(value: unknown): SubworkflowSourceMode {
  if (value === undefined || value === 'database') return 'database';
  if (value === 'parameter' || value === 'localFile' || value === 'url') return value;
  return 'unknown';
}

function parseEmbeddedWorkflow(
  value: unknown,
  sourceName: string,
  key: string,
  depth: number,
): NormalizedWorkflow | undefined {
  if (depth > 20) return undefined;
  let candidate = value;
  if (typeof candidate === 'string') {
    if (isExpression(candidate)) return undefined;
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!isRecord(candidate)) return undefined;
  return normalizeWorkflow(candidate, sourceName, { forcedKey: key, origin: 'embedded', depth });
}

function normalizeSubworkflowReference(
  node: WorkflowNode,
  workflowKey: string,
  sourceName: string,
  depth: number,
): SubworkflowReference | undefined {
  if (!isNodeType(node.type, EXECUTE_WORKFLOW_TYPE)) return undefined;
  const parameters = node.parameters;
  const sourceMode = normalizeSourceMode(parameters.source);
  const base: SubworkflowReference = {
    id: `${workflowKey}:${node.id}`,
    callerWorkflowKey: workflowKey,
    nodeId: node.id,
    nodeName: node.name,
    disabled: node.disabled,
    sourceMode,
    resolution: 'invalid',
  };

  if (sourceMode === 'database') {
    const locator = resourceLocatorValue(parameters.workflowId);
    base.rawTarget = parameters.workflowId;
    base.targetLabel = locator.label;
    if (!locator.value) return base;
    if (isExpression(locator.value)) return { ...base, resolution: 'dynamic' };
    return { ...base, resolution: 'missing', targetWorkflowId: locator.value };
  }

  if (sourceMode === 'parameter') {
    const rawTarget = parameters.workflowJson;
    base.rawTarget = rawTarget;
    if (typeof rawTarget === 'string' && isExpression(rawTarget)) return { ...base, resolution: 'dynamic' };
    const embeddedKey = `embedded:${workflowKey}:${node.id}`;
    const embeddedWorkflow = parseEmbeddedWorkflow(rawTarget, `${sourceName}#${node.name}`, embeddedKey, depth + 1);
    if (!embeddedWorkflow) return base;
    return {
      ...base,
      resolution: 'embedded',
      targetWorkflowKey: embeddedWorkflow.key,
      targetLabel: embeddedWorkflow.name,
      embeddedWorkflow,
    };
  }

  if (sourceMode === 'localFile' || sourceMode === 'url') {
    const rawTarget = sourceMode === 'localFile' ? parameters.workflowPath : parameters.workflowUrl;
    base.rawTarget = rawTarget;
    if (typeof rawTarget === 'string' && isExpression(rawTarget)) return { ...base, resolution: 'dynamic' };
    return {
      ...base,
      resolution: typeof rawTarget === 'string' && rawTarget.trim() ? 'external' : 'invalid',
      targetLabel: typeof rawTarget === 'string' ? rawTarget : undefined,
    };
  }

  return { ...base, rawTarget: parameters };
}

function normalizeConnections(
  rawConnections: unknown,
  nodes: WorkflowNode[],
  workflowKey: string,
  diagnostics: ParseDiagnostic[],
): WorkflowEdge[] {
  if (!isRecord(rawConnections)) {
    diagnostic(diagnostics, 'warning', 'connections.missing', 'Connections were missing or invalid; an empty graph was used.', 'connections');
    return [];
  }

  const nodeByName = new Map<string, WorkflowNode>();
  for (const node of nodes) {
    if (nodeByName.has(node.name)) {
      diagnostic(diagnostics, 'warning', 'node.name.duplicate', `Duplicate node name "${node.name}"; connections use the first occurrence.`, 'nodes');
    } else {
      nodeByName.set(node.name, node);
    }
  }

  const edges: WorkflowEdge[] = [];
  for (const [sourceName, byTypeValue] of Object.entries(rawConnections)) {
    if (!isRecord(byTypeValue)) {
      diagnostic(diagnostics, 'warning', 'connections.source.invalid', `Connections for "${sourceName}" were skipped.`, `connections.${sourceName}`);
      continue;
    }
    for (const [connectionType, outputsValue] of Object.entries(byTypeValue)) {
      if (!Array.isArray(outputsValue)) {
        diagnostic(diagnostics, 'warning', 'connections.type.invalid', `Connection type "${connectionType}" was not an output array.`, `connections.${sourceName}.${connectionType}`);
        continue;
      }
      outputsValue.forEach((connectionsValue, outputIndex) => {
        if (connectionsValue === null || connectionsValue === undefined) return;
        const connections = Array.isArray(connectionsValue) ? connectionsValue : [];
        if (!Array.isArray(connectionsValue)) {
          diagnostic(diagnostics, 'warning', 'connections.output.invalid', 'Invalid output slot was skipped.', `connections.${sourceName}.${connectionType}[${outputIndex}]`);
        }
        connections.forEach((connection, connectionIndex) => {
          if (!isRecord(connection) || !stringValue(connection.node)) {
            diagnostic(diagnostics, 'warning', 'connection.invalid', 'Malformed connection was skipped.', `connections.${sourceName}.${connectionType}[${outputIndex}][${connectionIndex}]`);
            return;
          }
          const targetName = String(connection.node);
          const sourceNodeId = nodeByName.get(sourceName)?.id;
          const targetNodeId = nodeByName.get(targetName)?.id;
          const targetType = stringValue(connection.type) ?? connectionType;
          const inputIndex = finiteNumber(connection.index) ?? 0;
          const valid = Boolean(sourceNodeId && targetNodeId);
          if (!valid) {
            diagnostic(diagnostics, 'warning', 'connection.dangling', `Connection from "${sourceName}" to "${targetName}" references a missing node.`, `connections.${sourceName}`);
          }
          edges.push({
            id: `edge-${stableHash([workflowKey, sourceName, connectionType, outputIndex, targetName, targetType, inputIndex, connectionIndex])}`,
            sourceNodeId,
            targetNodeId,
            sourceName,
            targetName,
            connectionType,
            targetConnectionType: targetType,
            outputIndex,
            inputIndex,
            valid,
          });
        });
      });
    }
  }
  return edges;
}

interface NormalizeOptions {
  forcedKey?: string;
  origin?: 'imported' | 'embedded';
  depth?: number;
}

function normalizeWorkflow(
  raw: JsonRecord,
  sourceName: string,
  options: NormalizeOptions = {},
): NormalizedWorkflow | undefined {
  if (!Array.isArray(raw.nodes)) return undefined;
  const diagnostics: ParseDiagnostic[] = [];
  const exportedId = stringValue(raw.id);
  const key = options.forcedKey ?? (exportedId ? `workflow:${exportedId}` : `anonymous:${stableHash(raw)}`);
  const name = stringValue(raw.name) ?? (sourceName.replace(/\.json$/i, '') || 'Unnamed workflow');
  if (!exportedId && options.origin !== 'embedded') {
    diagnostic(diagnostics, 'warning', 'workflow.id.generated', 'Workflow has no exported ID; a content-derived local identity was used.', 'id');
  }

  const nodes: WorkflowNode[] = [];
  const stickyNotes: StickyNote[] = [];
  raw.nodes.forEach((candidate, index) => {
    const normalized = normalizeNode(candidate, index, key, diagnostics);
    if (!normalized) return;
    if ('content' in normalized && 'color' in normalized) stickyNotes.push(normalized);
    else nodes.push(normalized);
  });
  const edges = normalizeConnections(raw.connections, nodes, key, diagnostics);
  const depth = options.depth ?? 0;
  const subworkflowReferences = nodes
    .map((node) => normalizeSubworkflowReference(node, key, sourceName, depth))
    .filter((reference): reference is SubworkflowReference => Boolean(reference));

  const workflow: NormalizedWorkflow = {
    key,
    id: exportedId,
    name,
    versionId: stringValue(raw.versionId),
    active: typeof raw.active === 'boolean' ? raw.active : undefined,
    origin: options.origin ?? 'imported',
    sourceName,
    nodes,
    edges,
    stickyNotes,
    subworkflowReferences,
    diagnostics,
    raw,
  };
  diagnostics.forEach((item) => {
    item.workflowKey = key;
  });
  return workflow;
}

function workflowCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && 'data' in value) {
    if (Array.isArray(value.data)) return value.data;
    if (isRecord(value.data)) return [value.data];
  }
  return [value];
}

export function parseN8nDocument(value: unknown, sourceName = 'workflow.json'): ParseDocumentResult {
  const workflows: NormalizedWorkflow[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  workflowCandidates(value).forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      diagnostic(diagnostics, 'error', 'workflow.invalid', 'No supported n8n workflow structure detected.', `[${index}]`);
      return;
    }
    const workflow = normalizeWorkflow(candidate, sourceName);
    if (!workflow) {
      diagnostic(diagnostics, 'error', 'workflow.invalid', 'No supported n8n workflow structure detected.', `[${index}]`);
      return;
    }
    workflows.push(workflow);
    diagnostics.push(...workflow.diagnostics);
  });
  return { workflows, diagnostics };
}

export function parseN8nJson(text: string, sourceName = 'workflow.json'): ParseDocumentResult {
  try {
    return parseN8nDocument(JSON.parse(text) as unknown, sourceName);
  } catch {
    return {
      workflows: [],
      diagnostics: [{ severity: 'error', code: 'json.invalid', message: 'Invalid JSON.' }],
    };
  }
}

export function isWorkflowInputTrigger(node: WorkflowNode): boolean {
  return node.type === 'n8n-nodes-base.executeWorkflowTrigger' || node.type.endsWith('.executeWorkflowTrigger');
}

export function isExecuteWorkflowNode(node: WorkflowNode): boolean {
  return isNodeType(node.type, EXECUTE_WORKFLOW_TYPE);
}
