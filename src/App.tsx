import '@xyflow/react/dist/style.css';
import { Download, Flag, FolderOpen, GitBranch, Info, Layers3, Network, Play, RefreshCw, Repeat2, Shuffle, Square, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraphCanvas, type GraphCanvasHandle } from './components/GraphCanvas';
import { Sidebar } from './components/Sidebar';
import { parseN8nJson } from './n8n/parser';
import type { NormalizedWorkflow, ParseDiagnostic } from './n8n/types';
import { buildDependencyScene } from './renderers/dependencies/dependency';
import { buildExpandedScene } from './renderers/expanded/expanded';
import { analyzeSimulationGraph, buildSimulationPlan, checkpointsMayConflict, type SimulationMode } from './simulation/engine';
import {
  clearAllLocalData,
  loadUiState,
  loadWorkflows,
  removeWorkflow,
  saveUiState,
  saveWorkflow,
} from './storage/db';
import { createWorkspace, getMissingReferences } from './workspace/resolve';
import './styles.css';

type ViewMode = 'view' | 'dependency';

interface ImportResult {
  file: string;
  status: 'imported' | 'replaced' | 'skipped';
  message: string;
  diagnostics: ParseDiagnostic[];
}

interface SavedUiState {
  selectedKey?: string;
  view?: ViewMode;
}

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function restoredViewMode(value: unknown): ViewMode | undefined {
  if (value === 'dependency') return 'dependency';
  if (value === 'view' || value === 'original' || value === 'expanded') return 'view';
  return undefined;
}

export default function App() {
  const [imports, setImports] = useState<NormalizedWorkflow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [view, setView] = useState<ViewMode>('view');
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [highlightMissing, setHighlightMissing] = useState(false);
  const [simulationMode, setSimulationMode] = useState<SimulationMode>('random');
  const [simulationSpeed, setSimulationSpeed] = useState(700);
  const [checkpoints, setCheckpoints] = useState<Set<string>>(new Set());
  const [simulationPlan, setSimulationPlan] = useState<string[]>([]);
  const [simulationIndex, setSimulationIndex] = useState(0);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [repeatSimulation, setRepeatSimulation] = useState(false);
  const [showStarts, setShowStarts] = useState(true);
  const [showEnds, setShowEnds] = useState(true);
  const [showBranches, setShowBranches] = useState(false);
  const [showLoops, setShowLoops] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [busy, setBusy] = useState(true);
  const [exportError, setExportError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const graphRef = useRef<GraphCanvasHandle>(null);

  useEffect(() => {
    let active = true;
    Promise.all([loadWorkflows(), loadUiState<SavedUiState>('workspace')])
      .then(([stored, ui]) => {
        if (!active) return;
        setImports(stored);
        setSelectedKey(ui?.selectedKey);
        const restored = restoredViewMode(ui?.view);
        if (restored) setView(restored);
      })
      .catch((error: unknown) => {
        if (active) setImportResults([{ file: 'Browser storage', status: 'skipped', message: error instanceof Error ? error.message : 'Could not restore local data.', diagnostics: [] }]);
      })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  const workspace = useMemo(() => createWorkspace(imports, selectedKey), [imports, selectedKey]);
  const effectiveKey = workspace.selectedWorkflowKey;
  const workflow = effectiveKey ? workspace.workflows[effectiveKey] : undefined;

  useEffect(() => {
    if (busy) return;
    void saveUiState('workspace', { selectedKey: effectiveKey, view } satisfies SavedUiState);
  }, [busy, effectiveKey, view]);

  useEffect(() => {
    setCollapsedPaths(new Set());
    setCheckpoints(new Set());
    setSimulationRunning(false);
    setSimulationPlan([]);
  }, [effectiveKey]);

  const scene = useMemo(() => {
    if (!workflow || !effectiveKey) return { nodes: [], edges: [] };
    if (view === 'dependency') return buildDependencyScene(workspace, effectiveKey);
    return buildExpandedScene(workspace, effectiveKey, { collapsedPaths });
  }, [workflow, effectiveKey, view, workspace, collapsedPaths]);

  const simulationAnalysis = useMemo(() => analyzeSimulationGraph(scene), [scene]);
  const checkpointConflict = useMemo(() => checkpointsMayConflict(scene, checkpoints), [scene, checkpoints]);
  const activeNodeId = simulationRunning ? simulationPlan[simulationIndex] : undefined;

  useEffect(() => {
    setCheckpoints((current) => {
      const retained = [...current].filter((id) => scene.nodes.some((node) => node.id === id));
      return retained.length === current.size ? current : new Set(retained);
    });
  }, [scene]);

  useEffect(() => {
    if (!simulationRunning) return;
    if (!simulationPlan.length || simulationIndex >= simulationPlan.length) {
      setSimulationRunning(false);
      return;
    }
    const timer = window.setTimeout(() => {
      if (simulationIndex + 1 < simulationPlan.length) {
        setSimulationIndex((value) => value + 1);
        return;
      }
      if (!repeatSimulation) {
        setSimulationRunning(false);
        return;
      }
      const nextPlan = buildSimulationPlan(scene, simulationMode, checkpoints);
      setSimulationPlan(nextPlan);
      setSimulationIndex(0);
      if (!nextPlan.length) setSimulationRunning(false);
    }, simulationSpeed);
    return () => window.clearTimeout(timer);
  }, [simulationRunning, simulationPlan, simulationIndex, simulationSpeed, repeatSimulation, scene, simulationMode, checkpoints]);

  const importFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    const next = new Map(imports.map((item) => [item.key, item]));
    const results: ImportResult[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        results.push({ file: file.name, status: 'skipped', message: 'File exceeds the 20 MB safety limit.', diagnostics: [] });
        continue;
      }
      try {
        const parsed = parseN8nJson(await file.text(), file.name);
        if (!parsed.workflows.length) {
          results.push({ file: file.name, status: 'skipped', message: 'No usable workflow graph was found.', diagnostics: parsed.diagnostics });
          continue;
        }
        let replacements = 0;
        for (const parsedWorkflow of parsed.workflows) {
          if (next.has(parsedWorkflow.key)) replacements += 1;
          next.set(parsedWorkflow.key, parsedWorkflow);
          await saveWorkflow(parsedWorkflow);
        }
        results.push({
          file: file.name,
          status: replacements ? 'replaced' : 'imported',
          message: `${parsed.workflows.length} workflow${parsed.workflows.length === 1 ? '' : 's'} accepted${replacements ? `; ${replacements} replaced` : ''}.`,
          diagnostics: parsed.diagnostics,
        });
      } catch (error) {
        results.push({ file: file.name, status: 'skipped', message: error instanceof Error ? error.message : 'Import failed.', diagnostics: [] });
      }
    }
    const updated = [...next.values()];
    setImports(updated);
    const lastAccepted = [...results].reverse().find((item) => item.status !== 'skipped');
    if (lastAccepted) {
      const latest = [...updated].reverse().find((item) => item.sourceName === lastAccepted.file);
      if (latest) setSelectedKey(latest.key);
    }
    setImportResults(results);
  }, [imports]);

  const handleRemove = async (key: string) => {
    await removeWorkflow(key);
    setImports((current) => current.filter((item) => item.key !== key));
    if (selectedKey === key) setSelectedKey(undefined);
  };

  const handleClear = async () => {
    if (!window.confirm('Remove every imported workflow and saved UI setting from this browser?')) return;
    await clearAllLocalData();
    setImports([]);
    setSelectedKey(undefined);
    setCollapsedPaths(new Set());
    setCheckpoints(new Set());
    setSimulationRunning(false);
    setImportResults([]);
  };

  const togglePath = useCallback((path: string) => {
    setSimulationRunning(false);
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setSimulationRunning(false);
    setCollapsedPaths(new Set());
  }, []);

  const collapseEveryWorkflow = useCallback(() => {
    setSimulationRunning(false);
    setCollapsedPaths(new Set(scene.nodes
      .filter((node) => node.kind === 'boundary' && typeof node.data.instancePath === 'string')
      .map((node) => String(node.data.instancePath))));
  }, [scene]);

  const toggleCheckpoint = useCallback((id: string) => {
    if (view !== 'view' || simulationMode !== 'custom' || simulationRunning) return;
    const candidate = scene.nodes.find((node) => node.id === id);
    if (!candidate || !['workflow', 'placeholder', 'port'].includes(candidate.kind)) return;
    setCheckpoints((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [view, simulationMode, simulationRunning, scene.nodes]);

  const startSimulation = useCallback(() => {
    const plan = buildSimulationPlan(scene, simulationMode, checkpoints);
    setSimulationPlan(plan);
    setSimulationIndex(0);
    setSimulationRunning(Boolean(plan.length));
  }, [scene, simulationMode, checkpoints]);

  const stopSimulation = useCallback(() => {
    setSimulationRunning(false);
    setSimulationPlan([]);
    setSimulationIndex(0);
  }, []);

  const runExport = async (format: 'png' | 'svg') => {
    if (!workflow) return;
    setExportError(undefined);
    try {
      await graphRef.current?.export(format, workflow.name, view);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  const missing = getMissingReferences(workspace, effectiveKey);
  const diagnostics = workflow?.diagnostics ?? [];

  return (
    <main
      className={`app-shell ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); void importFiles(event.dataTransfer.files); }}
    >
      <Sidebar workspace={workspace} selectedKey={effectiveKey} onSelect={setSelectedKey} onRemove={(key) => void handleRemove(key)} onClear={() => void handleClear()} onViewMissing={() => setView('dependency')} />
      <section className="workspace">
        <header className="topbar">
          <div className="title-block">
            <small>{workflow ? 'Workflow canvas' : 'n8n workflow visualizer'}</small>
            <h1>{workflow?.name ?? 'Import a workflow to begin'}</h1>
            {workflow ? <span>{workflow.nodes.length} nodes · {workflow.edges.length} connections · {workflow.subworkflowReferences.length} calls</span> : null}
          </div>
          <div className="toolbar">
            <input ref={fileRef} type="file" accept="application/json,.json" multiple hidden onChange={(event) => { if (event.target.files) void importFiles(event.target.files); event.currentTarget.value = ''; }} />
            <button type="button" className="button primary" onClick={() => fileRef.current?.click()}><Upload size={16} /> Import JSON</button>
            {workflow ? <>
              <div className="export-menu"><Download size={15} /><button type="button" onClick={() => void runExport('png')}>PNG</button><button type="button" onClick={() => void runExport('svg')}>SVG</button></div>
            </> : null}
          </div>
        </header>

        {workflow ? (
          <>
            <div className="viewbar">
              <div className="segmented" aria-label="Graph view">
                <button className={view === 'view' ? 'is-active' : ''} type="button" onClick={() => setView('view')}><Layers3 size={15} /> View</button>
                <button className={view === 'dependency' ? 'is-active' : ''} type="button" onClick={() => setView('dependency')}><Network size={15} /> Dependency</button>
              </div>
              <div className="view-status">
                {view === 'view' ? <div className="expand-actions"><button className="text-button" type="button" onClick={expandAll}>Expand all</button><button className="text-button" type="button" onClick={collapseEveryWorkflow}>Collapse all</button></div> : null}
                {missing.length ? <>
                  <label className="highlight-toggle" title="Highlight workflow call nodes whose dependencies are missing"><input type="checkbox" checked={highlightMissing} onChange={(event) => setHighlightMissing(event.target.checked)} /><span /> Highlight missing</label>
                  <button className="warning-pill warning-link" type="button" onClick={() => setView('dependency')}>{missing.length} missing dependenc{missing.length === 1 ? 'y' : 'ies'} · Click to view</button>
                </> : null}
                {diagnostics.length ? <span className="diagnostic-pill">{diagnostics.length} parser note{diagnostics.length === 1 ? '' : 's'}</span> : null}
              </div>
            </div>
            <div className={`simulation-bar ${view !== 'view' ? 'is-hidden' : ''}`}>
              <div className="simulation-primary">
                <button className={`button simulation-run ${simulationRunning ? 'is-running' : ''}`} type="button" onClick={simulationRunning ? stopSimulation : startSimulation}>
                  {simulationRunning ? <Square size={14} /> : <Play size={14} />}{simulationRunning ? 'Stop' : 'Simulate'}
                </button>
                <label>Speed<select value={simulationSpeed} onChange={(event) => setSimulationSpeed(Number(event.target.value))}><option value={250}>Fast · 0.25s</option><option value={700}>Normal · 0.7s</option><option value={1400}>Slow · 1.4s</option><option value={2500}>Very slow · 2.5s</option></select></label>
                <div className="mode-switch" aria-label="Simulation mode">
                  <button type="button" className={simulationMode === 'random' ? 'is-active' : ''} onClick={() => { stopSimulation(); setSimulationMode('random'); }}><Shuffle size={13} /> Random</button>
                  <button type="button" className={simulationMode === 'custom' ? 'is-active' : ''} onClick={() => { stopSimulation(); setSimulationMode('custom'); }}><Flag size={13} /> Custom</button>
                </div>
                <button type="button" aria-pressed={repeatSimulation} className={`repeat-toggle ${repeatSimulation ? 'is-active' : ''}`} onClick={() => setRepeatSimulation((value) => !value)} title="Automatically start a new simulation when the current one finishes"><RefreshCw size={13} /> Repeat</button>
                {simulationMode === 'custom' ? <span className="checkpoint-help">Click nodes to set checkpoints · {checkpoints.size} selected <button type="button" onClick={() => setCheckpoints(new Set())}>Clear</button></span> : <span className="checkpoint-help">Branches are chosen randomly.</span>}
              </div>
              <div className="simulation-overlays" aria-label="Simulation highlights">
                <span>Show:</span>
                <button type="button" aria-pressed={showStarts} className={showStarts ? 'is-active' : ''} onClick={() => setShowStarts((value) => !value)}>Starts</button>
                <button type="button" aria-pressed={showEnds} className={showEnds ? 'is-active' : ''} onClick={() => setShowEnds((value) => !value)}>Possible ends</button>
                <button type="button" aria-pressed={showBranches} className={showBranches ? 'is-active' : ''} onClick={() => setShowBranches((value) => !value)}><GitBranch size={12} /> Branches</button>
                <button type="button" aria-pressed={showLoops} className={showLoops ? 'is-active' : ''} onClick={() => setShowLoops((value) => !value)}><Repeat2 size={12} /> Loops</button>
                {checkpointConflict ? <span className="simulation-note">Some checkpoints conflict; one compatible branch will be chosen randomly.</span> : null}
              </div>
            </div>
            <GraphCanvas
              ref={graphRef}
              scene={scene}
              onTogglePath={togglePath}
              onNodeActivate={toggleCheckpoint}
              highlightMissing={highlightMissing}
              activeNodeId={activeNodeId}
              checkpointIds={checkpoints}
              startIds={simulationAnalysis.starts}
              endIds={simulationAnalysis.ends}
              branchIds={simulationAnalysis.branches}
              loopIds={simulationAnalysis.loops}
              showStarts={showStarts}
              showEnds={showEnds}
              showBranches={showBranches}
              showLoops={showLoops}
            />
            {exportError ? <div className="toast error"><Info size={16} />{exportError}<button onClick={() => setExportError(undefined)} aria-label="Dismiss"><X size={15} /></button></div> : null}
          </>
        ) : (
          <section className="empty-state">
            <div className="empty-icon"><FolderOpen size={34} /></div>
            <h2>{busy ? 'Restoring local workflows…' : 'Drop n8n JSON exports here'}</h2>
            <p>Explore original node placement, workflow dependencies, and recursively expanded sub-workflows. Files stay on this device.</p>
            <button type="button" className="button primary large" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={18} /> Choose JSON files</button>
            <small>Single workflows, arrays, and common data wrappers are supported.</small>
          </section>
        )}
      </section>
      {dragging ? <div className="drop-overlay"><Upload size={34} /><strong>Drop JSON workflows to import</strong><span>Valid files are kept even when another file fails.</span></div> : null}
      {importResults.length ? (
        <aside className="import-panel" role="dialog" aria-label="Import results">
          <header><div><strong>Import results</strong><small>{importResults.filter((item) => item.status !== 'skipped').length} accepted · {importResults.filter((item) => item.status === 'skipped').length} skipped</small></div><button className="icon-button" aria-label="Close import results" onClick={() => setImportResults([])}><X size={16} /></button></header>
          <div className="result-list">
            {importResults.map((result, index) => <article key={`${result.file}:${index}`} className={`result status-${result.status}`}><span className="status-dot" /><div><strong>{result.file}</strong><p>{result.message}</p>{result.diagnostics.length ? <details><summary>{result.diagnostics.length} warning/error details</summary><ul>{result.diagnostics.slice(0, 12).map((item, itemIndex) => <li key={`${item.code}:${itemIndex}`}><b>{item.code}</b> — {item.message}</li>)}</ul></details> : null}</div></article>)}
          </div>
        </aside>
      ) : null}
    </main>
  );
}
