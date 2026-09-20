import { describe, it, expect } from 'vitest';
import { isStageFrame } from './ws-chat';
import { toolLabel } from './tool-label';

/**
 * The socket carries two kinds of frame down one pipe. Telling them apart
 * wrongly is the one way stage narration could damage a conversation: a
 * turn result mistaken for narration would lose the reply, and narration
 * mistaken for a turn result would draw an error bubble. Both directions
 * are pinned here.
 */
describe('isStageFrame', () => {
  it('recognises narration', () => {
    expect(isStageFrame({ type: 'stage', state: 'start', name: 'soqlQuery', seq: 0 })).toBe(true);
  });

  it('never claims a turn result', () => {
    expect(isStageFrame({ status: 'complete', assistantText: 'Done.', toolCalls: [] })).toBe(false);
    expect(isStageFrame({ status: 'error', error: 'rate_limited' })).toBe(false);
  });

  it('treats anything unrecognised as a turn result, as this client always did', () => {
    // A future frame type must not be swallowed as narration — it falls
    // through to the result handler, which is the pre-existing behaviour.
    expect(isStageFrame({ type: 'text.delta', text: 'hi' })).toBe(false);
    expect(isStageFrame(null)).toBe(false);
    expect(isStageFrame(undefined)).toBe(false);
    expect(isStageFrame('stage')).toBe(false);
    expect(isStageFrame(42)).toBe(false);
  });
});

describe('toolLabel', () => {
  it('reads a specialist call as its name', () => {
    expect(toolLabel('ask_schema_specialist_a0x9z1')).toBe('schema specialist');
    expect(toolLabel('handoff_to_metadata_expert_b1c2d3')).toBe('metadata expert');
  });

  it('leaves an ordinary tool alone apart from the underscores', () => {
    expect(toolLabel('soqlQuery')).toBe('soqlQuery');
    expect(toolLabel('deploy_metadata')).toBe('deploy metadata');
  });
});
