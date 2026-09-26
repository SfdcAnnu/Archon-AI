import { describe, expect, it } from 'vitest';
import { editsCurrentBuild, intentOf, stripWake, WAKE_RE } from './archon-intent';

describe('intentOf', () => {
  it('reads today as a dashboard', () => {
    expect(intentOf('What happened today?')).toBe('dash');
    expect(intentOf("Give me today's briefing")).toBe('dash');
    expect(intentOf('show me the dashboard')).toBe('dash');
  });
  it('reads failures, drafts, approvals and charts', () => {
    expect(intentOf('Show the failures')).toBe('failures');
    expect(intentOf('what went wrong this morning')).toBe('failures');
    expect(intentOf('Show my drafts')).toBe('drafts');
    expect(intentOf('what is waiting for approval')).toBe('approvals');
    expect(intentOf('Cost by agent as a chart')).toBe('chart');
  });
  it('reads a usage or token report', () => {
    expect(intentOf('show me a report of all my agents and how much each has used till now')).toBe('usage');
    expect(intentOf('too many tokens taken by the lead intake qualifier')).toBe('usage');
    expect(intentOf('Cost by agent as a chart')).toBe('chart');
  });
  it('does not mistake a booking approval for the approvals list', () => {
    expect(intentOf('Book the meeting only after a human approves')).toBe(null);
  });
  it('reads a build, and a request to see it again', () => {
    expect(intentOf('Build a WhatsApp support agent for property customers')).toBe('build');
    expect(intentOf('create a new agent that scores deals')).toBe('build');
    expect(intentOf('show me the graph again')).toBe('build-back');
  });
  it('reads how-is-it-doing as words only', () => {
    expect(intentOf('How is the lead intake agent doing?')).toBe('how');
    expect(intentOf('is the risk scorer ok')).toBe('how');
  });
  it('reads close', () => {
    expect(intentOf('close')).toBe('close');
    expect(intentOf("That's all, thanks")).toBe('close');
    expect(intentOf('go back')).toBe('close');
  });
  it('gives nothing for plain conversation', () => {
    expect(intentOf('hello')).toBe(null);
    expect(intentOf('Also send a welcome email through Gmail')).toBe(null);
    expect(intentOf('')).toBe(null);
  });
});

describe('editsCurrentBuild', () => {
  it('tells an edit from a fresh request', () => {
    expect(editsCurrentBuild('Make it an Automation agent as well')).toBe(true);
    expect(editsCurrentBuild('Build a WhatsApp support agent')).toBe(false);
  });
});

describe('wake word', () => {
  it('matches the greeting forms and strips them', () => {
    expect(WAKE_RE.test('Hey Archon, what happened today')).toBe(true);
    expect(WAKE_RE.test('hello archon')).toBe(true);
    expect(WAKE_RE.test('archon please')).toBe(false);
    expect(stripWake('Hey Archon, what happened today')).toBe('what happened today');
    expect(stripWake('OK Archon.')).toBe('');
  });
});
