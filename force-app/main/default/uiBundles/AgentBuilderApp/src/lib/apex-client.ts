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
  const res = await withTimeout(
    sdk.fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    }),
    requestTimeoutMs,
    'Apex REST call'
  );
  const body = (await res.json()) as T | { error: string };
  if (!res.ok) {
    const message = (body as { error?: string })?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}
