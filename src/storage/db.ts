import { deleteDB, openDB, type DBSchema } from 'idb';
import { PARSER_VERSION, parseN8nDocument } from '../n8n/parser';
import type { JsonRecord, NormalizedWorkflow, StoredWorkflowRecord } from '../n8n/types';

const DB_NAME = 'n8n-workflow-visualizer';

interface VisualizerDB extends DBSchema {
  workflows: {
    key: string;
    value: StoredWorkflowRecord;
  };
  ui: {
    key: string;
    value: unknown;
  };
}

function database() {
  return openDB<VisualizerDB>(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('workflows')) db.createObjectStore('workflows', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('ui')) db.createObjectStore('ui');
    },
  });
}

export async function saveWorkflow(workflow: NormalizedWorkflow): Promise<void> {
  if (workflow.origin !== 'imported') return;
  const db = await database();
  try {
    await db.put('workflows', {
      key: workflow.key,
      sourceName: workflow.sourceName,
      importedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      raw: workflow.raw,
    });
  } finally { db.close(); }
}

export async function loadWorkflows(): Promise<NormalizedWorkflow[]> {
  const db = await database();
  try {
    const records = await db.getAll('workflows');
    return records.flatMap((record) => parseN8nDocument(record.raw, record.sourceName).workflows);
  } finally { db.close(); }
}

export async function removeWorkflow(key: string): Promise<void> {
  const db = await database();
  try { await db.delete('workflows', key); } finally { db.close(); }
}

export async function saveUiState(key: string, value: unknown): Promise<void> {
  const db = await database();
  try { await db.put('ui', value, key); } finally { db.close(); }
}

export async function loadUiState<T>(key: string): Promise<T | undefined> {
  const db = await database();
  try { return (await db.get('ui', key)) as T | undefined; } finally { db.close(); }
}

export async function clearAllLocalData(): Promise<void> {
  const db = await database();
  const transaction = db.transaction(['workflows', 'ui'], 'readwrite');
  await Promise.all([transaction.objectStore('workflows').clear(), transaction.objectStore('ui').clear()]);
  await transaction.done;
  db.close();
}

export async function replaceRawWorkflow(
  key: string,
  sourceName: string,
  raw: JsonRecord,
): Promise<void> {
  const db = await database();
  try {
    await db.put('workflows', {
      key,
      sourceName,
      importedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      raw,
    });
  } finally { db.close(); }
}

export async function destroyDatabaseForTests(): Promise<void> {
  await deleteDB(DB_NAME);
}
