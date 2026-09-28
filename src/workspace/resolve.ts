import type {
  NormalizedWorkflow,
  SubworkflowReference,
  WorkflowFamily,
  Workspace,
} from '../n8n/types';

function collectEmbedded(workflow: NormalizedWorkflow, target: Record<string, NormalizedWorkflow>): void {
  for (const reference of workflow.subworkflowReferences) {
    const embedded = reference.embeddedWorkflow;
    if (!embedded || target[embedded.key]) continue;
    target[embedded.key] = embedded;
    collectEmbedded(embedded, target);
  }
}

function resolveReference(
  reference: SubworkflowReference,
  idIndex: Map<string, string>,
): SubworkflowReference {
  if (reference.sourceMode !== 'database' || !reference.targetWorkflowId) return { ...reference };
  const targetWorkflowKey = idIndex.get(reference.targetWorkflowId);
  if (!targetWorkflowKey) return { ...reference, resolution: 'missing', targetWorkflowKey: undefined };
  return { ...reference, resolution: 'resolved', targetWorkflowKey };
}

function connectedComponents(workflows: Record<string, NormalizedWorkflow>): WorkflowFamily[] {
  const adjacency = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const missingByWorkflow = new Map<string, Set<string>>();
  const missingReferencesByWorkflow = new Map<string, number>();
  const incoming = new Map<string, number>();

  for (const key of Object.keys(workflows)) {
    adjacency.set(key, new Set());
    outgoing.set(key, new Set());
    incoming.set(key, 0);
  }

  for (const workflow of Object.values(workflows)) {
    for (const reference of workflow.subworkflowReferences) {
      if (reference.targetWorkflowKey && workflows[reference.targetWorkflowKey]) {
        adjacency.get(workflow.key)?.add(reference.targetWorkflowKey);
        adjacency.get(reference.targetWorkflowKey)?.add(workflow.key);
        outgoing.get(workflow.key)?.add(reference.targetWorkflowKey);
        if (!reference.disabled) {
          incoming.set(reference.targetWorkflowKey, (incoming.get(reference.targetWorkflowKey) ?? 0) + 1);
        }
      } else if (reference.targetWorkflowId && !reference.disabled) {
        const set = missingByWorkflow.get(workflow.key) ?? new Set<string>();
        set.add(reference.targetWorkflowId);
        missingByWorkflow.set(workflow.key, set);
        missingReferencesByWorkflow.set(workflow.key, (missingReferencesByWorkflow.get(workflow.key) ?? 0) + 1);
      }
    }
  }

  const seen = new Set<string>();
  const families: WorkflowFamily[] = [];
  for (const start of Object.keys(workflows).sort()) {
    if (seen.has(start)) continue;
    const queue = [start];
    const workflowKeys: string[] = [];
    const missing = new Set<string>();
    let missingReferenceCount = 0;
    while (queue.length) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      workflowKeys.push(current);
      missingByWorkflow.get(current)?.forEach((id) => missing.add(id));
      missingReferenceCount += missingReferencesByWorkflow.get(current) ?? 0;
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) queue.push(next);
      }
    }
    workflowKeys.sort((a, b) => workflows[a].name.localeCompare(workflows[b].name));
    const roots = workflowKeys.filter((key) => (incoming.get(key) ?? 0) === 0);
    const componentKeys = new Set(workflowKeys);
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visitForCycle = (key: string): boolean => {
      if (visiting.has(key)) return true;
      if (visited.has(key)) return false;
      visiting.add(key);
      for (const next of outgoing.get(key) ?? []) {
        if (componentKeys.has(next) && visitForCycle(next)) return true;
      }
      visiting.delete(key);
      visited.add(key);
      return false;
    };
    const cyclic = workflowKeys.some((key) => visitForCycle(key));
    families.push({
      id: `family:${workflowKeys[0]}`,
      workflowKeys,
      roots: roots.length ? roots : [...workflowKeys],
      missingTargetIds: [...missing].sort(),
      missingReferenceCount,
      cyclic,
    });
  }
  return families.sort((a, b) => {
    const aName = workflows[a.roots[0]]?.name ?? '';
    const bName = workflows[b.roots[0]]?.name ?? '';
    return aName.localeCompare(bName);
  });
}

export function createWorkspace(
  importedWorkflows: NormalizedWorkflow[],
  selectedWorkflowKey?: string,
): Workspace {
  const workflows: Record<string, NormalizedWorkflow> = {};
  for (const workflow of importedWorkflows) workflows[workflow.key] = workflow;
  for (const workflow of importedWorkflows) collectEmbedded(workflow, workflows);

  const idIndex = new Map<string, string>();
  for (const workflow of Object.values(workflows)) {
    if (workflow.id) idIndex.set(workflow.id, workflow.key);
  }

  for (const [key, workflow] of Object.entries(workflows)) {
    workflows[key] = {
      ...workflow,
      subworkflowReferences: workflow.subworkflowReferences.map((reference) =>
        resolveReference(reference, idIndex),
      ),
    };
  }

  const importedWorkflowKeys = importedWorkflows.map((workflow) => workflow.key);
  const selection = selectedWorkflowKey && workflows[selectedWorkflowKey]
    ? selectedWorkflowKey
    : importedWorkflowKeys[0];
  return {
    workflows,
    importedWorkflowKeys,
    families: connectedComponents(workflows),
    selectedWorkflowKey: selection,
  };
}

export function familyForWorkflow(workspace: Workspace, workflowKey: string): WorkflowFamily | undefined {
  return workspace.families.find((family) => family.workflowKeys.includes(workflowKey));
}

export function getMissingReferences(workspace: Workspace, workflowKey?: string): SubworkflowReference[] {
  const keys = workflowKey
    ? familyForWorkflow(workspace, workflowKey)?.workflowKeys ?? [workflowKey]
    : Object.keys(workspace.workflows);
  return keys.flatMap((key) =>
    (workspace.workflows[key]?.subworkflowReferences ?? []).filter(
      (reference) => reference.resolution === 'missing' && !reference.disabled,
    ),
  );
}

export function descendantWorkflowKeys(workspace: Workspace, rootKey: string): Set<string> {
  const result = new Set<string>();
  const visit = (key: string) => {
    if (result.has(key)) return;
    result.add(key);
    const workflow = workspace.workflows[key];
    for (const reference of workflow?.subworkflowReferences ?? []) {
      if (!reference.disabled && reference.targetWorkflowKey) visit(reference.targetWorkflowKey);
    }
  };
  visit(rootKey);
  return result;
}
