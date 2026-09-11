import { apexFetch } from './apex-client';

const BASE = '/services/apexrest/agent-builder/architect';

export type BuildStepState = 'pending' | 'running' | 'done' | 'warn' | 'failed';

export interface BuildStep {
  key: string;
  label: string;
  state: BuildStepState;
  detail?: string;
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
  status: 'queued' | 'running' | 'done' | 'failed';
  steps: BuildStep[];
  costUsd: number;
  maxCostUsd: number;
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

export async function getArchitectBuild(jobId: string): Promise<BuildJobView> {
  return apexFetch<BuildJobView>(`${BASE}?jobId=${encodeURIComponent(jobId)}`, { method: 'GET' }, 30000);
}

/** Who a prerequisite belongs to, in the client's vocabulary. */
export const ASSIGNEE_LABEL: Record<string, string> = {
  salesforce_admin: 'Needs your Salesforce admin',
  apex_developer: 'Needs an Apex developer',
  integration_owner: 'Needs whoever owns the integration',
  data_owner: 'Needs the data owner',
  business_owner: 'Needs a business decision',
};
