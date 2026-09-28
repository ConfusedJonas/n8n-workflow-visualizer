import { ChevronRight, FileJson2, Trash2, Workflow } from 'lucide-react';
import type { Workspace } from '../n8n/types';

interface SidebarProps {
  workspace: Workspace;
  selectedKey?: string;
  onSelect(key: string): void;
  onRemove(key: string): void;
  onClear(): void;
  onViewMissing(): void;
}

export function Sidebar({ workspace, selectedKey, onSelect, onRemove, onClear, onViewMissing }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand"><span><Workflow size={22} /></span><div><strong>n8n Visualizer</strong><small>Local workflow maps</small></div></div>
      <div className="sidebar-heading"><span>Workflow families</span><b>{workspace.importedWorkflowKeys.length}</b></div>
      <nav className="family-list" aria-label="Imported workflows">
        {workspace.families.map((family) => {
          const canonical = new Set(family.roots);
          return (
            <section className="family" key={family.id}>
              {family.workflowKeys.map((key) => {
                const workflow = workspace.workflows[key];
                if (!workflow || workflow.origin !== 'imported') return null;
                const isAlias = !canonical.has(key);
                return (
                  <div className={`workflow-row ${selectedKey === key ? 'is-active' : ''}`} key={key}>
                    <button type="button" className="workflow-select" onClick={() => onSelect(key)}>
                      <FileJson2 size={16} /><span><strong>{workflow.name}</strong><small>{isAlias ? 'Child workflow' : family.cyclic ? 'Cycle root' : 'Root workflow'} · {workflow.nodes.length} nodes</small></span><ChevronRight size={14} />
                    </button>
                    <button type="button" className="icon-button remove-button" aria-label={`Remove ${workflow.name}`} onClick={() => onRemove(key)}><Trash2 size={14} /></button>
                  </div>
                );
              })}
              {family.missingTargetIds.length ? <button type="button" className="family-warning" onClick={onViewMissing}>{family.missingTargetIds.length} unique missing dependenc{family.missingTargetIds.length === 1 ? 'y' : 'ies'} · {family.missingReferenceCount} reference{family.missingReferenceCount === 1 ? '' : 's'} · Click to view</button> : null}
            </section>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <p>All workflow data stays in this browser.</p>
        <button type="button" className="text-button danger" onClick={onClear} disabled={!workspace.importedWorkflowKeys.length}>Clear all local data</button>
      </div>
    </aside>
  );
}
