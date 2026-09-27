import { apexFetch } from './apex-client';

/** Talks to AgentExecutionsRestService.cls, a thin wrapper around
 *  AgentBuilderController's getExecutionLogs/getRunSteps — the same data
 *  the old agentExecutionLogs LWC already used. */
const EXECUTIONS_BASE = '/services/apexrest/agent-builder/executions/';

export interface RawAgentExecution {
  Id: string;
  Name: string;
  'AgentDefinition__r.Name': string;
  'AgentDefinition__r.Department__c': string;
  CorrelationId__c: string | null;
  RecordId__c: string | null;
  Status__c: string;
  AgentScore__c: number | null;
  AgentPriority__c: string | null;
  AgentReason__c: string | null;
  ToolsUsed__c: string | null;
  OutputPayload__c: string | null;
  ExecutionMs__c: number | null;
  Department__c: string | null;
  CreatedDate: string;
}

export interface ExecutionPage {
  records: RawAgentExecution[];
  total: number;
  pageSize: number;
  pageOffset: number;
}

export interface RunStepDto {
  nodeId: string;
  nodeLabel: string;
  nodeSubType: string;
  inputJson: string | null;
  outputJson: string | null;
  success: boolean;
  errorMsg: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunStepsResult {
  status: string;
  steps: RunStepDto[];
}

const STATUS_OPTIONS = ['SUCCESS', 'ERROR', 'QUEUED', 'RUNNING', 'WAITING', 'WAITING_APPROVAL', 'TIMEOUT'] as const;
export type ExecutionStatus = (typeof STATUS_OPTIONS)[number];
export { STATUS_OPTIONS };

export async function loadExecutionLogs(opts: {
  pageSize?: number;
  pageOffset?: number;
  status?: string;
}): Promise<ExecutionPage> {
  const params = new URLSearchParams();
  if (opts.pageSize != null) params.set('pageSize', String(opts.pageSize));
  if (opts.pageOffset != null) params.set('pageOffset', String(opts.pageOffset));
  if (opts.status) params.set('status', opts.status);
  return apexFetch<ExecutionPage>(`${EXECUTIONS_BASE}?${params.toString()}`, { method: 'GET' });
}

export async function loadRunSteps(correlationId: string): Promise<RunStepsResult> {
  return apexFetch<RunStepsResult>(`${EXECUTIONS_BASE}?correlationId=${encodeURIComponent(correlationId)}`, {
    method: 'GET',
  });
}
