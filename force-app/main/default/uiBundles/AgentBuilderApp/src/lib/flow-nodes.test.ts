import { describe, expect, it } from 'vitest';
import type { AgentConnection, AgentNode } from '@/types/agent';
import { flowNodeProblems, flowNodeSummary, isFlowPort, outputPortsFor } from './flow-nodes';

const node = (nodeSubType: string, config: Record<string, unknown>, nodeType: AgentNode['nodeType'] = 'logic'): AgentNode => ({
  id: 'n1', name: 'Step', nodeType, nodeSubType, config, positionX: 0, positionY: 0, sortOrder: 0, isEnabled: true,
});
const edge = (fromPort: AgentConnection['fromPort']): AgentConnection => ({ id: 'c', fromNodeId: 'n1', fromPort, toNodeId: 'n2', toPort: 'in' });

describe('flow nodes', () => {
  it('gives each step the exits the engine routes on', () => {
    expect(outputPortsFor('if_else').map(p => p.id)).toEqual(['yes', 'no']);
    expect(outputPortsFor('loop').map(p => p.id)).toEqual(['each', 'done']);
    expect(outputPortsFor('approval').map(p => p.id)).toEqual(['approved', 'rejected']);
    expect(outputPortsFor('create_task').map(p => p.id)).toEqual(['out']);
  });

  it('flags a loop with no list and no For each edge, and clears once set up', () => {
    expect(flowNodeProblems(node('loop', { collectionVar: '' }), [])).toHaveLength(2);
    expect(flowNodeProblems(node('loop', { collectionVar: '{!deals.records}' }), [edge('each')])).toEqual([]);
  });

  it('asks an if/else for a condition and at least one wired exit', () => {
    expect(flowNodeProblems(node('if_else', { condition: '{!item.Amount} > 5' }), [edge('no')])).toEqual([]);
    expect(flowNodeProblems(node('if_else', { condition: '' }), [])).toEqual(['No condition set', 'Connect the Yes or No exit']);
  });

  it('treats an empty field map as missing', () => {
    expect(flowNodeProblems(node('create_record', { objectType: 'Task', fieldMappings: '{\n  \n}' }, 'action'), [])).toEqual(['No fields to write']);
    expect(flowNodeProblems(node('create_record', { objectType: 'Task', fieldMappings: '{"Subject":"x"}' }, 'action'), [])).toEqual([]);
  });

  it('summarises a connector step by provider and tool', () => {
    expect(flowNodeSummary(node('call_tool', { provider: 'gmail', toolName: 'send_email' }, 'action'))).toBe('gmail · send_email');
    expect(isFlowPort('each')).toBe(true);
    expect(isFlowPort('tool')).toBe(false);
  });
});

describe('AI steps', () => {
  const aiStep = (config: Record<string, unknown>) => ({ ...node('gpt4', config, 'ai'), nodeType: 'ai' as const });

  it('are told apart from the agent root by their step flag', async () => {
    const { isAiStep } = await import('./flow-nodes');
    expect(isAiStep(aiStep({ step: true }))).toBe(true);
    expect(isAiStep(aiStep({ systemPrompt: 'root' }))).toBe(false);
  });

  it('summarise their outputs and flag what is missing', () => {
    const ok = aiStep({ step: true, instruction: 'Classify {!c.Subject}', outputVariable: 'triage', outputs: [{ name: 'category', type: 'choice', options: ['billing', 'technical'] }, { name: 'urgent', type: 'boolean' }] });
    expect(flowNodeSummary(ok)).toBe('→ triage { category, urgent }');
    expect(flowNodeProblems(ok, [])).toEqual([]);
    const bad = aiStep({ step: true, instruction: '', outputVariable: '', outputs: [{ name: 'category', type: 'choice', options: ['only'] }] });
    expect(flowNodeProblems(bad, [])).toEqual(['No prompt', 'Name the result so later steps can read it', '"category" needs two or more choices']);
  });
});
