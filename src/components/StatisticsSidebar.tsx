import { GitMerge, Network, SquareStack, Workflow, X } from 'lucide-react';

export interface WorkflowStatistics {
  nodes: number;
  connections: number;
  subworkflows: number;
  subworkflowCalls: number;
  endNodes: number;
  missingDependencies: number;
  missingReferences: number;
}

interface StatisticsSidebarProps {
  name: string;
  statistics: WorkflowStatistics;
  onClose(): void;
}

export function StatisticsSidebar({ name, statistics, onClose }: StatisticsSidebarProps) {
  const rows = [
    { label: 'Total nodes', value: statistics.nodes, icon: Workflow },
    { label: 'Connections', value: statistics.connections, icon: Network },
    { label: 'Sub-workflows', value: statistics.subworkflows, detail: `${statistics.subworkflowCalls} call${statistics.subworkflowCalls === 1 ? '' : 's'}`, icon: SquareStack },
    { label: 'Possible end nodes', value: statistics.endNodes, icon: GitMerge },
  ];
  return (
    <aside className="statistics-sidebar" aria-label="Workflow statistics">
      <header>
        <div><small>Workflow statistics</small><strong title={name}>{name}</strong></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close statistics"><X size={15} /></button>
      </header>
      <div className="statistics-list">
        {rows.map(({ label, value, detail, icon: Icon }) => (
          <div className="statistic" key={label}>
            <Icon size={17} />
            <span><small>{label}</small>{detail ? <em>{detail}</em> : null}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <p className="statistics-note">All totals include resolved descendant workflows. Possible end nodes are calculated from the selected main workflow only because internal sub-workflow ends return control to their caller.</p>
      {statistics.missingDependencies ? (
        <div className="statistics-warning"><strong>{statistics.missingDependencies} unique missing</strong><span>{statistics.missingReferences} call reference{statistics.missingReferences === 1 ? '' : 's'}</span></div>
      ) : null}
    </aside>
  );
}
