export type JsonRecord = Record<string, unknown>;

export type DiagnosticSeverity = 'warning' | 'error';

export interface ParseDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
  workflowKey?: string;
}
export interface Point {
  x: number;
  y: number;
}

export interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  typeVersion?: number;
  position: Point;
  disabled: boolean;
  parameters: JsonRecord;
  raw: JsonRecord;
  sourceIndex: number;
}

export interface WorkflowEdge {
  id: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  sourceName: string;
  targetName: string;
  connectionType: string;
  targetConnectionType: string;
  outputIndex: number;
  inputIndex: number;
  valid: boolean;
}

export interface StickyNote {
  id: string;
  name: string;
  position: Point;
  width: number;
  height: number;
  color: number | string;
  content: string;
  raw: JsonRecord;
}

export type SubworkflowSourceMode = 'database' | 'parameter' | 'localFile' | 'url' | 'unknown';
export type SubworkflowResolution =
  | 'resolved'
  | 'missing'
  | 'dynamic'
  | 'external'
  | 'embedded'
  | 'invalid';

export interface SubworkflowReference {
  id: string;
  callerWorkflowKey: string;
  nodeId: string;
  nodeName: string;
  disabled: boolean;
  sourceMode: SubworkflowSourceMode;
  resolution: SubworkflowResolution;
  targetWorkflowId?: string;
  targetWorkflowKey?: string;
  targetLabel?: string;
  rawTarget?: unknown;
  embeddedWorkflow?: NormalizedWorkflow;
}

export interface NormalizedWorkflow {
  key: string;
  id?: string;
  name: string;
  versionId?: string;
  active?: boolean;
  origin: 'imported' | 'embedded';
  sourceName: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  stickyNotes: StickyNote[];
  subworkflowReferences: SubworkflowReference[];
  diagnostics: ParseDiagnostic[];
  raw: JsonRecord;
}

export interface ParseDocumentResult {
  workflows: NormalizedWorkflow[];
  diagnostics: ParseDiagnostic[];
}

export interface WorkflowFamily {
  id: string;
  workflowKeys: string[];
  roots: string[];
  missingTargetIds: string[];
  missingReferenceCount: number;
  cyclic: boolean;
}

export interface Workspace {
  workflows: Record<string, NormalizedWorkflow>;
  importedWorkflowKeys: string[];
  families: WorkflowFamily[];
  selectedWorkflowKey?: string;
}

export interface StoredWorkflowRecord {
  key: string;
  sourceName: string;
  importedAt: string;
  parserVersion: number;
  raw: JsonRecord;
}
