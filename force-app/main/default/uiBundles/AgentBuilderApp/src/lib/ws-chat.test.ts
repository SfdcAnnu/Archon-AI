import { describe, it, expect } from 'vitest';
import { isStageFrame, isTextDelta, isTextReset } from './ws-chat';
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

describe('text frames', () => {
  it('recognises a delta and a reset', () => {
    expect(isTextDelta({ type: 'text.delta', delta: 'Hello', seq: 3 })).toBe(true);
    expect(isTextReset({ type: 'text.reset', seq: 4 })).toBe(true);
  });

  it('refuses a delta with no text, which would append undefined', () => {
    expect(isTextDelta({ type: 'text.delta', seq: 3 })).toBe(false);
    expect(isTextDelta({ type: 'text.delta', delta: 42, seq: 3 })).toBe(false);
  });

  it('keeps the three frame kinds apart', () => {
    const delta = { type: 'text.delta', delta: 'x', seq: 0 };
    expect(isStageFrame(delta)).toBe(false);
    expect(isTextReset(delta)).toBe(false);
    const stage = { type: 'stage', state: 'start', name: 'soqlQuery', seq: 0 };
    expect(isTextDelta(stage)).toBe(false);
    const turn = { status: 'complete', assistantText: 'done' };
    expect(isTextDelta(turn)).toBe(false);
    expect(isTextReset(turn)).toBe(false);
  });

  it('an empty delta is still a delta, not a turn result', () => {
    // The server can emit one; treating it as a turn result would draw an
    // error bubble mid-reply.
    expect(isTextDelta({ type: 'text.delta', delta: '', seq: 9 })).toBe(true);
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
