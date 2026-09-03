import { apexFetch } from './apex-client';

/** Talks to AgentSchemaRestService.cls — native Apex describes powering the
 *  Prebuilt-action pickers (real objects, real fields, real picklists). */
const SCHEMA_BASE = '/services/apexrest/agent-builder/schema/';

export interface SchemaObject {
  name: string;
  label: string;
  custom: boolean;
}

export interface SchemaField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  createable: boolean;
  updateable: boolean;
  picklistValues: string[];
  referenceTo: string[];
}

let objectsCache: SchemaObject[] | null = null;
const fieldsCache = new Map<string, SchemaField[]>();

export async function loadSchemaObjects(): Promise<SchemaObject[]> {
  if (objectsCache) return objectsCache;
  const list = await apexFetch<SchemaObject[]>(`${SCHEMA_BASE}?action=objects`, { method: 'GET' });
  objectsCache = [...list].sort((a, b) => a.label.localeCompare(b.label));
  return objectsCache;
}

export async function loadSchemaFields(objectName: string): Promise<SchemaField[]> {
  const hit = fieldsCache.get(objectName);
  if (hit) return hit;
  const list = await apexFetch<SchemaField[]>(
    `${SCHEMA_BASE}?action=fields&object=${encodeURIComponent(objectName)}`,
    { method: 'GET' }
  );
  const sorted = [...list].sort((a, b) => Number(b.required) - Number(a.required) || a.label.localeCompare(b.label));
  fieldsCache.set(objectName, sorted);
  return sorted;
}
