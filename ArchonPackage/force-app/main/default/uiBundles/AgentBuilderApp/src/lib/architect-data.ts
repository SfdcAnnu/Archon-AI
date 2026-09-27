import { apexFetch } from './apex-client';

const BASE = '/services/apexrest/agent-builder/architect';

export type BuildStepState = 'pending' | 'running' | 'done' | 'warn' | 'failed';

export interface BuildStep {
  key: string;
  label: string;
  state: BuildStepState;
  detail?: string;
  /** What this stage cost and took on its own — shown per row so the
   *  expensive one is visible instead of inferred from a single total. */
  costUsd?: number;
  ms?: number;
  /** Restored from an earlier run's checkpoint: done, and free. */
  reused?: boolean;
  /** When the stage began (epoch ms), so the card can count while it runs. */
  startedAt?: number;
  /** Every model call the stage made, in order — the empty ones too. */
  calls?: BuildCall[];
  tokensIn?: number;
  tokensOut?: number;
}

export interface BuildCall {
  specialist: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  ms: number;
  failed?: string;
}

export interface BuildPrerequisite {
  id: string;
  kind: string;
  title: string;
  why: string;
  steps: string[];
  assignee: string;
  blocking: boolean;
  status: string;
  estimatedEffort?: string;
}

export interface BuildResult {
  agentId: string;
  apiName: string;
  status: string;
  summarySteps: string[];
  shape: string;
  prerequisites: BuildPrerequisite[];
  estimate: { costPerRunUsd: number; latencySeconds: number };
  assumptions: string[];
  notes: string[];
  confidence: string;
}

export interface BuildJobView {
  jobId: string;
  /** `paused` is a budget stop, not a failure — every finished stage is
   *  saved and `resume` continues from there without re-charging for them. */
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed';
  steps: BuildStep[];
  /** Total across the whole resume chain — what this build has actually
   *  cost, which is what the ceiling governs. */
  costUsd: number;
  thisRunCostUsd?: number;
  maxCostUsd: number;
  resumedFrom?: string;
  resumable?: boolean;
  elapsedMs: number;
  result?: BuildResult;
  error?: string;
}

/** Starts the async build. Returns the job id to poll. */
export async function startArchitectBuild(input: {
  requirement: string;
  attachmentText?: string;
  maxCostUsd?: number;
}): Promise<string> {
  const res = await apexFetch<{ jobId: string }>(BASE, { method: 'POST', body: JSON.stringify(input) }, 60000);
  return res.jobId;
}

/**
 * Continue a build that stopped at its ceiling. Returns the NEW job id to
 * poll — the stages already paid for are restored from the paused build's
 * checkpoint rather than run again, so only the unfinished ones cost
 * anything.
 */
export async function resumeArchitectBuild(jobId: string, maxCostUsd?: number): Promise<string> {
  const res = await apexFetch<{ jobId: string }>(
    BASE,
    { method: 'POST', body: JSON.stringify({ resumeJobId: jobId, ...(maxCostUsd ? { maxCostUsd } : {}) }) },
    60000,
  );
  return res.jobId;
}

/** A build that stopped early but kept everything it produced. */
export interface ResumableBuild {
  jobId: string;
  requirement: string;
  costUsd: number;
  maxCostUsd: number;
  stagesDone: number;
  stagesTotal: number;
  startedAt: string;
  /** Checkpointed by an older pipeline — resuming replays a design made
   *  under rules that have since changed. */
  stale?: boolean;
}

/**
 * Builds this org can still finish. Without this the only route back to a
 * checkpoint is the build page the user happened to leave open, which would
 * strand work they have already paid for.
 */
export async function listResumableBuilds(): Promise<ResumableBuild[]> {
  const res = await apexFetch<{ builds: ResumableBuild[] }>(`${BASE}?resumable=true`, { method: 'GET' }, 30000);
  return res.builds ?? [];
}

/** Forget a build and its saved progress. The checkpoint lives on the
 *  server, not in Salesforce, so deleting the agent never removes it. */
export async function discardArchitectBuild(jobId: string): Promise<void> {
  await apexFetch<{ deleted: boolean }>(
    `${BASE}?jobId=${encodeURIComponent(jobId)}`,
    { method: 'DELETE' },
    30000,
  );
}

export async function getArchitectBuild(jobId: string): Promise<BuildJobView> {
  return apexFetch<BuildJobView>(`${BASE}?jobId=${encodeURIComponent(jobId)}`, { method: 'GET' }, 30000);
}

/** Everything a build has produced so far, stage by stage — what the chat's
 *  build workspace draws. Read-only; the design preview is laid out from
 *  the checkpoint, not saved. */
export interface BuildDetail {
  jobId: string;
  status: BuildJobView['status'];
  stoppedAfter: string | null;
  requirement: { goal: string; capabilities: string[]; openQuestions: string[]; successCriteria: string[]; riskLevel: string | null; trigger: string | null; agentType?: 'communication' | 'automation' | 'both'; clarifications?: string[] } | null;
  survey: Record<string, { count: number; sample: string[] } | { keys: string[] } | string> | null;
  match: { coverage: number | null; matched: string[]; gaps: Array<{ state: 'partial' | 'missing'; capability: string; why: string; have: string; need: string }> } | null;
  design: {
    name: string; department: string; description: string | null;
    trigger: { type: string; channel?: string; sobject?: string } | null;
    preview: { nodes: Array<{ id: string; name: string; nodeType: 'ai' | 'subagent' | 'tool' | 'catalog'; nodeSubType: string; config: Record<string, unknown>; positionX: number; positionY: number }>; connections: Array<{ id: string; fromNodeId: string; fromPort: 'tool'; toNodeId: string; toPort: 'in' }> };
    counts: { specialists: number; tools: number; approvals: number };
    instructions: Array<{ id: string; label: string; role: 'agent' | 'subagent'; text: string }>;
    guardrails: string[];
    budgets: { maxSteps: number; maxCostUsd: number; timeoutSeconds: number } | null;
  } | null;
  review: { verdict: 'pass' | 'pass_with_risk' | 'blocked' | 'fail'; uncovered?: string[]; failures?: Array<Record<string, unknown>>; repaired?: boolean } | null;
  prerequisites: BuildPrerequisite[];
  result: BuildResult | null;
  error: string | null;
}
export async function getArchitectBuildDetail(jobId: string): Promise<BuildDetail> {
  return apexFetch<BuildDetail>(`${BASE}?jobId=${encodeURIComponent(jobId)}&resource=detail`, { method: 'GET' }, 30000);
}

/** Who a prerequisite belongs to, in the client's vocabulary. */
export const ASSIGNEE_LABEL: Record<string, string> = {
  salesforce_admin: 'Needs your Salesforce admin',
  apex_developer: 'Needs an Apex developer',
  integration_owner: 'Needs whoever owns the integration',
  data_owner: 'Needs the data owner',
  business_owner: 'Needs a business decision',
};

// ── ✦ Rewrite an instruction for the model that will run it ──────────
export interface RewriteResult {
  instructions: string;
  changed: string[];
  costUsd: number;
}

export async function rewritePrompt(input: {
  draft: string;
  role: 'agent' | 'subagent' | 'tool';
  modelId: string;
  agentName?: string;
  department?: string;
  channel?: string;
  toolNames?: string[];
}): Promise<RewriteResult> {
  return apexFetch<RewriteResult>(
    `${BASE}/rewrite`,
    { method: 'POST', body: JSON.stringify({ action: 'rewrite', ...input }) },
    120000,
  );
}

// ── ✦ Ask Archon ─────────────────────────────────────────────────────
export type CopilotOperation =
  | { kind: 'setInstructions'; nodeId: string; value: string; why: string }
  | { kind: 'setDescription'; nodeId: string; value: string; why: string }
  | { kind: 'setRoutingDescription'; nodeId: string; value: string; why: string }
  | { kind: 'setModel'; nodeId: string; value: string; why: string }
  | { kind: 'setApproval'; nodeId: string; value: boolean; why: string }
  | { kind: 'setContextPolicy'; nodeId: string; value: 'isolated' | 'windowed' | 'full'; why: string }
  | { kind: 'setMode'; nodeId: string; value: 'call' | 'transfer'; why: string };

/** What the copilot decided the person wants done beyond an answer. Only
 *  the Home mode raises 'build_agent'; the page then starts the build and
 *  shows its stages — the copilot never claims a build happened. */
export type CopilotAction = { kind: 'none' } | { kind: 'build_agent'; requirement: string };

export interface CopilotReply {
  reply: string;
  operations: CopilotOperation[];
  action?: CopilotAction;
  costUsd: number;
}

export async function askArchon(input: {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  agent?: {
    apiName: string;
    name: string;
    department?: string;
    nodes: Array<{ id: string; name: string; nodeType: string; nodeSubType: string; config: Record<string, unknown> }>;
  };
  /** 'builder' (default) proposes changes to the open agent; 'home' answers
   *  from the platform snapshot and can hand a requirement to the Architect. */
  mode?: 'builder' | 'home';
  /** The Home dashboard's own numbers, so answers match what is on screen. */
  platform?: Record<string, unknown>;
}): Promise<CopilotReply> {
  return apexFetch<CopilotReply>(
    `${BASE}/copilot`,
    { method: 'POST', body: JSON.stringify({ action: 'copilot', ...input }) },
    120000,
  );
}

/** Human label for a proposed change, for the preview list. */
export const OPERATION_LABEL: Record<CopilotOperation['kind'], string> = {
  setInstructions: 'Rewrite its instructions',
  setDescription: 'Change the description',
  setRoutingDescription: 'Change when it gets used',
  setModel: 'Change the model',
  setApproval: 'Change the approval setting',
  setContextPolicy: 'Change what it can see',
  setMode: 'Change how it answers',
};
