import '@xyflow/react/dist/style.css';
import { BarChart3, Download, Flag, FolderOpen, Info, Layers3, Network, Play, RefreshCw, Repeat2, Route, ScanSearch, Shuffle, Square, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraphCanvas, type GraphCanvasHandle } from './components/GraphCanvas';
import { Sidebar } from './components/Sidebar';
import { StatisticsSidebar, type WorkflowStatistics } from './components/StatisticsSidebar';
import { parseN8nJson } from './n8n/parser';
import type { NormalizedWorkflow, ParseDiagnostic } from './n8n/types';
import { buildDependencyScene } from './renderers/dependencies/dependency';
import { buildExpandedScene } from './renderers/expanded/expanded';
import { buildOriginalScene } from './renderers/workflow/original';
import { analyzeCheckpointConflicts, analyzeSimulationGraph, buildSimulationSteps, type SimulationMode, type SimulationStep } from './simulation/engine';
import {
  clearAllLocalData,
  loadUiState,
  loadWorkflows,
  removeWorkflow,
  saveUiState,
  saveWorkflow,
} from './storage/db';
import { createWorkspace, descendantWorkflowKeys, getMissingReferences } from './workspace/resolve';
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
  const [simulationPlan, setSimulationPlan] = useState<SimulationStep[]>([]);
  const [simulationIndex, setSimulationIndex] = useState(0);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [repeatSimulation, setRepeatSimulation] = useState(false);
  const [executedCounts, setExecutedCounts] = useState<Map<string, number>>(new Map());
  const [executedEdgeIds, setExecutedEdgeIds] = useState<Set<string>>(new Set());
  const [showStarts, setShowStarts] = useState(false);
  const [showLoops, setShowLoops] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [followSimulation, setFollowSimulation] = useState(false);
  const [showStatistics, setShowStatistics] = useState(false);
  const [simulationNotice, setSimulationNotice] = useState<string>();
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
    setExecutedCounts(new Map());
    setExecutedEdgeIds(new Set());
    setSimulationNotice(undefined);
  }, [effectiveKey]);

  const scene = useMemo(() => {
    if (!workflow || !effectiveKey) return { nodes: [], edges: [] };
    if (view === 'dependency') return buildDependencyScene(workspace, effectiveKey);
    return buildExpandedScene(workspace, effectiveKey, { collapsedPaths });
  }, [workflow, effectiveKey, view, workspace, collapsedPaths]);

  const simulationAnalysis = useMemo(() => analyzeSimulationGraph(scene), [scene]);
  const checkpointConflicts = useMemo(() => simulationMode === 'custom' ? analyzeCheckpointConflicts(scene, checkpoints) : [], [scene, checkpoints, simulationMode]);
  const checkpointConflict = checkpointConflicts.length > 0;
  const activeNodeIds = useMemo(() => new Set(simulationRunning ? simulationPlan[simulationIndex]?.nodeIds ?? [] : []), [simulationRunning, simulationPlan, simulationIndex]);
  const activeEdgeIds = useMemo(() => new Set(simulationRunning ? simulationPlan[simulationIndex]?.edgeIds ?? [] : []), [simulationRunning, simulationPlan, simulationIndex]);
  const displayStartIds = useMemo(() => new Set([
    ...simulationAnalysis.starts,
    ...scene.nodes.filter((node) => node.data.boundaryEntry).map((node) => node.id),
  ]), [scene.nodes, simulationAnalysis.starts]);

  useEffect(() => {
    setCheckpoints((current) => {
      const retained = [...current].filter((id) => scene.nodes.some((node) => node.id === id));
      return retained.length === current.size ? current : new Set(retained);
    });
  }, [scene]);

  useEffect(() => {
    if (!checkpointConflict) setShowConflicts(false);
  }, [checkpointConflict]);

  useEffect(() => {
    if (!simulationRunning) return;
    if (!simulationPlan.length || simulationIndex >= simulationPlan.length) {
      setSimulationRunning(false);
      return;
    }
    const timer = window.setTimeout(() => {
      if (simulationIndex + 1 < simulationPlan.length) {
        const nextIndex = simulationIndex + 1;
        const nextStep = simulationPlan[nextIndex];
        setExecutedCounts((current) => {
          const next = new Map(current);
          nextStep.nodeIds.forEach((id) => next.set(id, (next.get(id) ?? 0) + 1));
          return next;
        });
        setExecutedEdgeIds((current) => new Set([...current, ...nextStep.edgeIds]));
        setSimulationIndex(nextIndex);
        return;
      }
      if (!repeatSimulation) {
        setSimulationRunning(false);
        return;
      }
      const nextPlan = buildSimulationSteps(scene, simulationMode, checkpoints);
      setSimulationPlan(nextPlan);
      setSimulationIndex(0);
      setExecutedCounts(new Map(nextPlan[0]?.nodeIds.map((id) => [id, 1] as const) ?? []));
      setExecutedEdgeIds(new Set(nextPlan[0]?.edgeIds ?? []));
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
    if (view !== 'view' || !['custom', 'shortest'].includes(simulationMode) || simulationRunning) return;
    const candidate = scene.nodes.find((node) => node.id === id);
    if (!candidate || !['workflow', 'placeholder', 'port'].includes(candidate.kind)) return;
    setSimulationNotice(undefined);
    setCheckpoints((current) => {
      const next = simulationMode === 'shortest' ? new Set<string>() : new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [view, simulationMode, simulationRunning, scene.nodes]);

  const startSimulation = useCallback(() => {
    if (simulationMode === 'shortest' && checkpoints.size !== 1) {
      setSimulationNotice('Select one destination node before starting Shortest mode.');
      return;
    }
    setSimulationNotice(undefined);
    const plan = buildSimulationSteps(scene, simulationMode, checkpoints);
    setSimulationPlan(plan);
    setSimulationIndex(0);
    setExecutedCounts(new Map(plan[0]?.nodeIds.map((id) => [id, 1] as const) ?? []));
    setExecutedEdgeIds(new Set(plan[0]?.edgeIds ?? []));
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
  const missingTargetIds = new Set(missing.flatMap((reference) => reference.targetWorkflowId ? [reference.targetWorkflowId] : []));
  const diagnostics = workflow?.diagnostics ?? [];
  const statistics = useMemo<WorkflowStatistics | undefined>(() => {
    if (!workflow) return undefined;
    const originalAnalysis = analyzeSimulationGraph(buildOriginalScene(workflow));
    const descendantKeys = effectiveKey ? descendantWorkflowKeys(workspace, effectiveKey) : new Set<string>();
    const descendantWorkflows = [...descendantKeys].flatMap((key) => workspace.workflows[key] ? [workspace.workflows[key]] : []);
    const targets = new Set(workflow.subworkflowReferences.map((reference) => (
      reference.targetWorkflowKey ?? reference.targetWorkflowId ?? reference.embeddedWorkflow?.key ?? `${reference.sourceMode}:${reference.nodeId}`
    )));
    return {
      nodes: workflow.nodes.length,
      connections: workflow.edges.length,
      nodesIncludingSubworkflows: descendantWorkflows.reduce((sum, item) => sum + item.nodes.length, 0),
      connectionsIncludingSubworkflows: descendantWorkflows.reduce((sum, item) => sum + item.edges.length, 0),
      subworkflows: targets.size,
      subworkflowCalls: workflow.subworkflowReferences.length,
      loops: originalAnalysis.loopGroups.length,
      branches: originalAnalysis.branches.size,
      endNodes: originalAnalysis.ends.size,
      missingDependencies: missingTargetIds.size,
      missingReferences: missing.length,
    };
  }, [workflow, effectiveKey, workspace, missing.length, missingTargetIds.size]);

  return (
    <main
      className={`app-shell ${dragging ? 'is-dragging' : ''} ${showStatistics && workflow ? 'has-statistics' : ''}`}
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
              <button type="button" className={`button ${showStatistics ? 'is-active' : ''}`} aria-pressed={showStatistics} onClick={() => setShowStatistics((value) => !value)}><BarChart3 size={15} /> Statistics</button>
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
                {missingTargetIds.size ? <>
                  <label className="highlight-toggle" title="Highlight workflow call nodes whose dependencies are missing"><input type="checkbox" checked={highlightMissing} onChange={(event) => setHighlightMissing(event.target.checked)} /><span /> Highlight missing</label>
                  <button className="warning-pill warning-link" type="button" onClick={() => setView('dependency')}>{missingTargetIds.size} unique missing dependenc{missingTargetIds.size === 1 ? 'y' : 'ies'} · {missing.length} reference{missing.length === 1 ? '' : 's'} · Click to view</button>
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
                  <button type="button" className={simulationMode === 'random' ? 'is-active' : ''} onClick={() => { stopSimulation(); setSimulationNotice(undefined); setCheckpoints(new Set()); setSimulationMode('random'); }}><Shuffle size={13} /> Random</button>
                  <button type="button" className={simulationMode === 'custom' ? 'is-active' : ''} onClick={() => { stopSimulation(); setSimulationNotice(undefined); setSimulationMode('custom'); }}><Flag size={13} /> Custom</button>
                  <button type="button" className={simulationMode === 'all' ? 'is-active' : ''} onClick={() => { stopSimulation(); setSimulationNotice(undefined); setCheckpoints(new Set()); setSimulationMode('all'); }}><ScanSearch size={13} /> All</button>
                  <button type="button" className={simulationMode === 'shortest' ? 'is-active' : ''} onClick={() => { stopSimulation(); setSimulationNotice(undefined); setCheckpoints(new Set()); setSimulationMode('shortest'); }}><Route size={13} /> Shortest</button>
                </div>
                <button type="button" aria-pressed={repeatSimulation} className={`repeat-toggle ${repeatSimulation ? 'is-active' : ''}`} onClick={() => setRepeatSimulation((value) => !value)} title="Automatically start a new simulation when the current one finishes"><RefreshCw size={13} /> Repeat</button>
                <button type="button" aria-pressed={followSimulation} className={`repeat-toggle ${followSimulation ? 'is-active' : ''}`} onClick={() => setFollowSimulation((value) => !value)} title="Smoothly pan when active nodes leave the central viewing area"><ScanSearch size={13} /> Follow</button>
                {simulationMode === 'custom' ? <span className="checkpoint-help">Click nodes to set checkpoints · {checkpoints.size} selected <button className="checkpoint-clear" type="button" onClick={() => setCheckpoints(new Set())}>Clear</button></span>
                  : simulationMode === 'shortest' ? <span className="checkpoint-help">{checkpoints.size ? 'Destination selected' : 'Click one destination node'} {checkpoints.size ? <button className="checkpoint-clear" type="button" onClick={() => setCheckpoints(new Set())}>Clear</button> : null}</span>
                    : simulationMode === 'all' ? <span className="checkpoint-help">Chooses the route with the greatest reachable node coverage.</span>
                      : <span className="checkpoint-help">Branches are chosen randomly.</span>}
              </div>
              <div className="simulation-overlays" aria-label="Simulation highlights">
                <span>Highlights:</span>
                <button type="button" aria-pressed={showStarts} className={showStarts ? 'is-active' : ''} onClick={() => setShowStarts((value) => !value)}>Start nodes</button>
                <button type="button" aria-pressed={showLoops} className={showLoops ? 'is-active' : ''} onClick={() => setShowLoops((value) => !value)}><Repeat2 size={12} /> Individual loops</button>
                {checkpointConflict ? <button type="button" aria-pressed={showConflicts} className={showConflicts ? 'is-active' : ''} onClick={() => setShowConflicts((value) => !value)}><Flag size={12} /> Conflicting branches</button> : null}
                {checkpointConflict ? <span className="simulation-note">Some checkpoints conflict; one compatible branch will be chosen randomly.</span> : null}
                {simulationNotice ? <span className="simulation-note is-prominent" role="status">{simulationNotice}</span> : null}
              </div>
            </div>
            <GraphCanvas
              ref={graphRef}
              scene={scene}
              onTogglePath={togglePath}
              onNodeActivate={toggleCheckpoint}
              highlightMissing={highlightMissing}
              activeNodeIds={activeNodeIds}
              activeEdgeIds={activeEdgeIds}
              executedCounts={executedCounts}
              executedEdgeIds={executedEdgeIds}
              checkpointIds={checkpoints}
              startIds={displayStartIds}
              loopGroups={simulationAnalysis.loopGroups}
              conflictGroups={checkpointConflicts}
              showStarts={showStarts}
              showLoops={showLoops}
              showConflicts={showConflicts}
              followActive={followSimulation && simulationRunning}
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
      {showStatistics && workflow && statistics ? <StatisticsSidebar name={workflow.name} statistics={statistics} onClose={() => setShowStatistics(false)} /> : null}
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
