import { apexFetch } from './apex-client';

/** "Wake servers" on the Setup page — talks to AgentSetupRestService.cls
 *  (action: 'wake') → ArchonWakeService.cls.
 *
 *  Free-tier Render sleeps idle services, and an agent run crosses the
 *  Archon server AND every MCP server its tools live on. Waking them one
 *  by one inside the first tool call is how a run eats a minute of cold
 *  starts (or dies on Apex's callout ceiling). This lets an admin fire all
 *  the wake-ups up front and watch each service come online.
 *
 *  Each request is ONE shallow probe (nothing on the server waits for a
 *  cold start); the poll loop below is what turns probes into progress. */
const SETUP_BASE = '/services/apexrest/agent-builder/setup';

export type WakeStatus = 'online' | 'waking' | 'unreachable' | 'pending';

export interface ServiceState {
  key: string;
  name: string;
  url: string;
  status: WakeStatus;
  ms: number | null;
  message: string | null;
}

export interface WakeResult {
  archon: ServiceState;
  targets: ServiceState[];
  configured: boolean;
}

/** Apex spends up to 30s on the health hop and 30s on the fan-out — with the
 *  browser's own margin on top, so it never gives up before Apex has. */
const WAKE_TIMEOUT_MS = 70000;

export async function wakeServers(): Promise<WakeResult> {
  return apexFetch<WakeResult>(SETUP_BASE, { method: 'POST', body: JSON.stringify({ action: 'wake' }) }, WAKE_TIMEOUT_MS);
}

/** Every service listed in a result, Archon first — the shape the page renders. */
export function allServices(result: WakeResult): ServiceState[] {
  return [result.archon, ...result.targets];
}

/** Nothing left that polling could still change. */
export function isSettled(result: WakeResult): boolean {
  return allServices(result).every(s => s.status === 'online' || s.status === 'unreachable');
}

export function isAllOnline(result: WakeResult): boolean {
  return allServices(result).every(s => s.status === 'online');
}

/** A client-side timeout here means Apex was still waiting on a cold host —
 *  keep polling; anything else is a real failure and stops the loop. */
function isTransientError(err: unknown): boolean {
  return err instanceof Error && /timed out after \d+ms|starting up/i.test(err.message);
}

export interface WakeLoopOptions {
  onUpdate: (result: WakeResult) => void;
  /** Stop signal — the page flips this when it unmounts or the user re-clicks. */
  isCancelled?: () => boolean;
  maxMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchOnce?: () => Promise<WakeResult>;
}

export type WakeOutcome = 'ready' | 'partial' | 'timeout' | 'cancelled';

/** Poll until every service is online or unreachable, or the budget runs out.
 *  Two cold Render services in series need ~60-120s; the default budget
 *  gives that a comfortable margin without polling forever. */
export async function wakeUntilSettled({
  onUpdate,
  isCancelled = () => false,
  maxMs = 180000,
  intervalMs = 5000,
  now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  fetchOnce = wakeServers,
}: WakeLoopOptions): Promise<WakeOutcome> {
  const started = now();
  let last: WakeResult | null = null;
  for (;;) {
    if (isCancelled()) return 'cancelled';
    try {
      last = await fetchOnce();
      if (isCancelled()) return 'cancelled';
      onUpdate(last);
      if (isSettled(last)) return isAllOnline(last) ? 'ready' : 'partial';
    } catch (err) {
      if (!isTransientError(err)) throw err;
    }
    if (now() - started >= maxMs) return 'timeout';
    await sleep(intervalMs);
  }
}
