import { describe, expect, it } from 'vitest';
import { readableFinding, reviewFindings, stageReport } from './build-report';
import type { BuildDetail } from './architect-data';

describe('readableFinding', () => {
  it('reads a plain sentence', () => {
    expect(readableFinding('"Calculate days since last completed Task."')).toEqual({ what: 'Calculate days since last completed Task.', why: null });
  });
  it('reads a JSON finding, whole or clipped', () => {
    expect(readableFinding('{"requirement":"Fetch news","rootCause":"No web search tool is attached."}')).toEqual({ what: 'Fetch news', why: 'No web search tool is attached.' });
    expect(readableFinding('{"requirement":"Check close date pushed","rootCause":"The design does not specify th')).toEqual({ what: 'Check close date pushed', why: 'The design does not specify th' });
    expect(readableFinding({ requirement: 'Score 0-100', rootCause: 'not stated' })).toEqual({ what: 'Score 0-100', why: 'not stated' });
  });
});

describe('reviewFindings', () => {
  it('merges the same requirement named twice, keeping the reason', () => {
    const f = reviewFindings({ verdict: 'fail', uncovered: ['Fetch news'], failures: [{ requirement: 'Fetch news', rootCause: 'No web search tool.' }] });
    expect(f).toEqual([{ what: 'Fetch news', why: 'No web search tool.' }]);
  });
});

describe('stageReport', () => {
  const d = {
    jobId: 'j', status: 'running', stoppedAfter: null, survey: null, design: null, review: null, prerequisites: [], result: null, error: null,
    requirement: { goal: 'Score one Opportunity for risk.', capabilities: ['read the Opportunity'], openQuestions: ['Web search is available'], successCriteria: [], riskLevel: 'low', trigger: null, agentType: 'automation' },
    match: { coverage: 0.8, matched: ['read the Opportunity'], gaps: [{ state: 'missing', capability: 'Risk fields', why: 'the agent writes them', have: '', need: 'Risk_Score__c on Opportunity' }] },
  } as unknown as BuildDetail;
  it('tells the requirement with its type and assumptions', () => {
    const r = stageReport('understand', d, null)!;
    expect(r).toContain('Understood your requirement');
    expect(r).toContain('Automation agent');
    expect(r).toContain('1. Web search is available');
  });
  it('tells each gap with how to close it', () => {
    const r = stageReport('match', d, null)!;
    expect(r).toContain('**Risk fields** — missing');
    expect(r).toContain('Metadata Expert');
  });
  it('has nothing to say for a stage without data', () => {
    expect(stageReport('design', d, null)).toBeNull();
  });
});
