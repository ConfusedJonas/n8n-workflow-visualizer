import '@xyflow/react/dist/style.css';
import { Download, FileJson2, Focus, FolderOpen, Info, Layers3, Network, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraphCanvas, type GraphCanvasHandle } from './components/GraphCanvas';
import { Sidebar } from './components/Sidebar';
import { parseN8nJson } from './n8n/parser';
import type { NormalizedWorkflow, ParseDiagnostic } from './n8n/types';
import { buildDependencyScene } from './renderers/dependencies/dependency';
import { buildExpandedScene } from './renderers/expanded/expanded';
import { buildOriginalScene } from './renderers/workflow/original';
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

type ViewMode = 'original' | 'dependency' | 'expanded';

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

function isViewMode(value: unknown): value is ViewMode {
  return value === 'original' || value === 'dependency' || value === 'expanded';
}

export default function App() {
  const [imports, setImports] = useState<NormalizedWorkflow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [view, setView] = useState<ViewMode>('expanded');
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [collapseAll, setCollapseAll] = useState(false);
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
        if (isViewMode(ui?.view)) setView(ui.view);
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
    setCollapseAll(false);
  }, [effectiveKey]);

  const scene = useMemo(() => {
    if (!workflow || !effectiveKey) return { nodes: [], edges: [] };
    if (view === 'original') return buildOriginalScene(workflow);
    if (view === 'dependency') return buildDependencyScene(workspace, effectiveKey);
    return buildExpandedScene(workspace, effectiveKey, { collapsedPaths, collapseAll });
  }, [workflow, effectiveKey, view, workspace, collapsedPaths, collapseAll]);

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
    setImportResults([]);
  };

  const togglePath = useCallback((path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
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
      <Sidebar workspace={workspace} selectedKey={effectiveKey} onSelect={setSelectedKey} onRemove={(key) => void handleRemove(key)} onClear={() => void handleClear()} />
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
              <button type="button" className="icon-button" title="Fit graph" aria-label="Fit graph" onClick={() => graphRef.current?.fit()}><Focus size={17} /></button>
              <div className="export-menu"><Download size={15} /><button type="button" onClick={() => void runExport('png')}>PNG</button><button type="button" onClick={() => void runExport('svg')}>SVG</button></div>
            </> : null}
          </div>
        </header>

        {workflow ? (
          <>
            <div className="viewbar">
              <div className="segmented" aria-label="Graph view">
                <button className={view === 'original' ? 'is-active' : ''} type="button" onClick={() => setView('original')}><FileJson2 size={15} /> Original</button>
                <button className={view === 'dependency' ? 'is-active' : ''} type="button" onClick={() => setView('dependency')}><Network size={15} /> Dependency</button>
                <button className={view === 'expanded' ? 'is-active' : ''} type="button" onClick={() => setView('expanded')}><Layers3 size={15} /> Expanded</button>
              </div>
              <div className="view-status">
                {view === 'expanded' ? <button className="text-button" type="button" onClick={() => { setCollapseAll((value) => !value); setCollapsedPaths(new Set()); }}>{collapseAll ? 'Expand all' : 'Collapse all'}</button> : null}
                {missing.length ? <span className="warning-pill">{missing.length} missing reference{missing.length === 1 ? '' : 's'}</span> : null}
                {diagnostics.length ? <span className="diagnostic-pill">{diagnostics.length} parser note{diagnostics.length === 1 ? '' : 's'}</span> : null}
              </div>
            </div>
            <GraphCanvas ref={graphRef} scene={scene} onTogglePath={togglePath} />
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
