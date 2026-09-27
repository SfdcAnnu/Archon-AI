import { describe, expect, it } from 'vitest';
import { agentHealth, costByAgent, failedRunsToday, runsByHour, todayEvents, todayTotals } from './archon-data';
import type { RawAgentExecution } from './executions-data';
import type { HomeStats } from './home-stats-data';

const now = new Date(2026, 8, 26, 14, 0, 0); // 26 Sep 2026, 14:00 local
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 8, 26 + dayOffset, h, m).toISOString();

const run = (over: Partial<RawAgentExecution>): RawAgentExecution => ({
  Id: 'a', Name: 'AE-1', 'AgentDefinition__r.Name': 'Deal Risk Scorer', 'AgentDefinition__r.Department__c': 'Sales',
  CorrelationId__c: null, RecordId__c: null, Status__c: 'SUCCESS', AgentScore__c: null, AgentPriority__c: null,
  AgentReason__c: null, ToolsUsed__c: null, OutputPayload__c: null, ExecutionMs__c: null, Department__c: null,
  CreatedDate: at(10), ...over,
});

const stats: HomeStats = {
  days: 1,
  byDay: [{ day: '2026-09-26', runsOk: 30, runsFailed: 2, runsOther: 2, turnsOk: 40, turnsFailed: 1 }],
  byAgent: [
    { apiName: 'deal_risk_scorer', name: 'Deal Risk Scorer', runsToday: 34, runsFailedToday: 2, turnsToday: 0, turnsFailedToday: 0, tokensIn: 400_000, tokensOut: 100_000 },
    { apiName: 'lead_intake', name: 'Lead Intake', runsToday: 0, runsFailedToday: 0, turnsToday: 41, turnsFailedToday: 1, tokensIn: 100_000, tokensOut: 20_000 },
  ],
  runs: 34, runsFailed: 2, turns: 41, turnsFailed: 1, tokensIn: 500_000, tokensOut: 120_000, generatedAt: at(14),
};

describe('runsByHour', () => {
  it('buckets today only, failures apart', () => {
    const hours = runsByHour([run({ CreatedDate: at(10) }), run({ CreatedDate: at(10, 42), Status__c: 'ERROR' }), run({ CreatedDate: at(10, 0, -1) })], now);
    expect(hours[10]).toEqual([1, 1]);
    expect(hours.reduce((a, [ok, bad]) => a + ok + bad, 0)).toBe(2);
  });
});

describe('todayTotals', () => {
  it('reads the last day of the window and prices the tokens', () => {
    const t = todayTotals(stats);
    expect(t.runs).toBe(34);
    expect(t.runsFailed).toBe(2);
    expect(t.turns).toBe(41);
    expect(t.spendUsd).toBeCloseTo(0.5 * 2.5 + 0.12 * 10, 5);
  });
  it('is all zero without data', () => {
    expect(todayTotals(null)).toEqual({ runs: 0, runsFailed: 0, turns: 0, turnsFailed: 0, spendUsd: 0 });
  });
});

describe('agentHealth', () => {
  it('ranks by activity with a success share and a mean run time', () => {
    const rows = agentHealth(stats, [run({ ExecutionMs__c: 4000 }), run({ ExecutionMs__c: 8000, Status__c: 'ERROR' })], now);
    expect(rows[0].name).toBe('Lead Intake');
    expect(rows[0].okPct).toBe(98);
    expect(rows[1].name).toBe('Deal Risk Scorer');
    expect(rows[1].okPct).toBe(94);
    expect(rows[1].avgMs).toBe(6000);
    expect(rows[0].avgMs).toBeNull();
  });
});

describe('todayEvents and failedRunsToday', () => {
  it('lists today newest first and tones failures', () => {
    const runs = [run({ CreatedDate: at(9) }), run({ CreatedDate: at(10, 42), Status__c: 'ERROR', AgentReason__c: 'field not writable' }), run({ CreatedDate: at(9, 0, -1) })];
    const ev = todayEvents({ runs, sessions: [], approvals: [], chatApprovals: [] }, now);
    expect(ev.map(e => e.tone)).toEqual(['bad', 'ok']);
    expect(ev[0].sub).toBe('field not writable');
    expect(failedRunsToday(runs, now)).toHaveLength(1);
  });
});

describe('costByAgent', () => {
  it('prices tokens per agent, largest first', () => {
    const rows = costByAgent(stats);
    expect(rows[0].name).toBe('Deal Risk Scorer');
    expect(rows[0].usd).toBeCloseTo(0.4 * 2.5 + 0.1 * 10, 5);
  });
});
