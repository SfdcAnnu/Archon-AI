import { createDataSDK } from '@salesforce/platform-sdk';

/**
 * Shared low-level client for calling this package's Apex REST resources
 * (AgentBuilderRestService.cls, AgentWebSocketController.cls, ...) from
 * the React UI Bundle. A UI Bundle cannot reach @AuraEnabled methods —
 * there's no Aura/LWC RPC bridge inside one — so Apex REST + the platform
 * SDK's CSRF-aware fetch() is the path instead (verified against the
 * real @salesforce/platform-sdk 10.24.0 types: no dedicated "invoke Apex"
 * API exists, just `graphql` + a raw `fetch`, and its CSRF interceptor
 * names "Apex REST" explicitly).
 *
 * Relative paths deliberately, not an absolute instance URL — confirmed
 * working against a real deployed UI Bundle (see loadAgentGraph's use of
 * this against the live WhatsApp Revival agent).
 */

/** createDataSDK() waits to detect a real Salesforce host surface — outside
 *  a deployed UI Bundle (e.g. plain `npm run dev` in a browser tab with no
 *  host frame to handshake with) it never resolves OR rejects, it just
 *  hangs. A race-against-timeout is the only way callers get a timely
 *  fallback instead of a permanent spinner. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Namespace of the managed package. Installed from the package, Apex REST
 *  lives under /services/apexrest/archon/... and serialized records carry
 *  archon__Field__c keys; deployed as plain source (the dev org) neither
 *  does. Which one this org is gets learned from the first call. */
export const PACKAGE_NAMESPACE = 'archon';
const NS_STORAGE_KEY = 'archon.apexNamespace';
const APEX_REST = '/services/apexrest/';

let apexNamespace: string | null = readStoredNamespace();

function readStoredNamespace(): string | null {
  try {
    return window.sessionStorage.getItem(NS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberNamespace(ns: string) {
  apexNamespace = ns;
  try {
    window.sessionStorage.setItem(NS_STORAGE_KEY, ns);
  } catch {
    // Private window or blocked storage — the in-memory value still holds.
  }
}

function namespacedPath(path: string, ns: string): string {
  return ns && path.startsWith(APEX_REST) ? `${APEX_REST}${ns}/${path.slice(APEX_REST.length)}` : path;
}

/** Salesforce's answer for a URL no @RestResource maps: 404 with NOT_FOUND. */
function isUnmappedUrl(status: number, body: unknown): boolean {
  return status === 404 && Array.isArray(body) && body.some(e => (e as { errorCode?: string })?.errorCode === 'NOT_FOUND');
}

/** archon__Role__c → Role__c, recursively, so the UI reads one shape in
 *  both kinds of org. */
export function stripNamespace<T>(value: T, ns: string): T {
  if (!ns || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => stripNamespace(v, ns)) as T;
  const prefix = `${ns}__`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k.startsWith(prefix) ? k.slice(prefix.length) : k] = stripNamespace(v, ns);
  }
  return out as T;
}

/** requestTimeoutMs default (15s) fits every existing caller — plain CRUD
 *  round-trips. Callers proxying a slow downstream operation (e.g. the
 *  agent generator's LLM call, given ~60s headroom on the Apex side by
 *  AgentGeneratorRestService) must pass a larger value or this races ahead
 *  of a callout that would otherwise have succeeded. */
export async function apexFetch<T>(path: string, init?: RequestInit, requestTimeoutMs = 15000): Promise<T> {
  const sdk = await withTimeout(createDataSDK(), 6000, 'createDataSDK()');
  if (!sdk.fetch) {
    throw new Error('Platform SDK has no fetch() on this surface — cannot reach Apex REST.');
  }
  const sdkFetch = sdk.fetch.bind(sdk);
  const send = (p: string) =>
    withTimeout(
      sdkFetch(p, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      }),
      requestTimeoutMs,
      'Apex REST call'
    );

  // Unknown org: try the packaged path first, fall back to the plain one.
  const ns = apexNamespace ?? PACKAGE_NAMESPACE;
  let res = await send(namespacedPath(path, ns));
  let body = (await res.json()) as T | { error: string };
  if (apexNamespace === null && path.startsWith(APEX_REST)) {
    if (isUnmappedUrl(res.status, body)) {
      res = await send(path);
      body = (await res.json()) as T | { error: string };
      if (!isUnmappedUrl(res.status, body)) rememberNamespace('');
    } else {
      rememberNamespace(ns);
    }
  }
  body = stripNamespace(body, apexNamespace ?? '');
  if (!res.ok) {
    const message = (body as { error?: string })?.error ?? `Request failed (${res.status})`;
    // Copy rule: never surface a raw provider/host error body. The Archon
    // server's free-tier host answers with an HTML "Application loading"
    // page while it wakes — translate that (or any HTML body) into words.
    const friendly = /<!doctype|<html/i.test(message)
      ? 'The Archon server is starting up — try again in a few seconds.'
      : message;
    throw new Error(friendly);
  }
  return body as T;
}
