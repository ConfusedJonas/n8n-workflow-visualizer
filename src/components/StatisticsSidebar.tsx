import { GitBranch, GitMerge, Network, Repeat2, SquareStack, Workflow, X } from 'lucide-react';

export interface WorkflowStatistics {
  nodes: number;
  connections: number;
  nodesIncludingSubworkflows: number;
  connectionsIncludingSubworkflows: number;
  subworkflows: number;
  subworkflowCalls: number;
  loops: number;
  branches: number;
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
    { label: 'Nodes incl. sub-workflows', value: statistics.nodesIncludingSubworkflows, icon: Workflow },
    { label: 'Connections incl. sub-workflows', value: statistics.connectionsIncludingSubworkflows, icon: Network },
    { label: 'Sub-workflows', value: statistics.subworkflows, detail: `${statistics.subworkflowCalls} call${statistics.subworkflowCalls === 1 ? '' : 's'}`, icon: SquareStack },
    { label: 'Loops', value: statistics.loops, icon: Repeat2 },
    { label: 'Branches', value: statistics.branches, icon: GitBranch },
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
      <p className="statistics-note">End nodes are calculated from the selected main workflow only. Internal sub-workflow ends return control to their caller.</p>
      {statistics.missingDependencies ? (
        <div className="statistics-warning"><strong>{statistics.missingDependencies} unique missing</strong><span>{statistics.missingReferences} call reference{statistics.missingReferences === 1 ? '' : 's'}</span></div>
      ) : null}
    </aside>
  );
}
