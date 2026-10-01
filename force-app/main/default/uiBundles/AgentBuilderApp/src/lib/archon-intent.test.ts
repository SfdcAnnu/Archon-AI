import { describe, expect, it } from 'vitest';
import { editsCurrentBuild, intentOf, stripWake, WAKE_RE } from './archon-intent';

describe('intentOf', () => {
  it('never opens a data view from words — that is the copilot\'s call', () => {
    expect(intentOf('What happened today?')).toBe(null);
    expect(intentOf('what you can do for me today')).toBe(null);
    expect(intentOf('Show the failures')).toBe(null);
    expect(intentOf('Show my drafts')).toBe(null);
    expect(intentOf('what is waiting for approval')).toBe(null);
    expect(intentOf('Cost by agent as a chart')).toBe(null);
    expect(intentOf('show me a report of all my agents and how much each has used till now')).toBe(null);
    expect(intentOf('How is the lead intake agent doing?')).toBe(null);
  });
  it('reads a request for an agent, however it is worded', () => {
    expect(intentOf('Note 10 agent I want to single agent that will show opportunity details their activities and on accounts and on their account activities details')).toBe('build');
    expect(intentOf('an agent that reports failures to the owner every morning')).toBe('build');
    expect(intentOf('show me the recent activities on this opportunity')).toBe(null);
  });
  it('reads a build, and a request to see it again', () => {
    expect(intentOf('Build a WhatsApp support agent for property customers')).toBe('build');
    expect(intentOf('create a new agent that scores deals')).toBe('build');
    expect(intentOf('show me the graph again')).toBe('build-back');
  });
  it('reads close', () => {
    expect(intentOf('close')).toBe('close');
    expect(intentOf("That's all, thanks")).toBe('close');
    expect(intentOf('go back')).toBe('close');
  });
  it('gives nothing for plain conversation', () => {
    expect(intentOf('hello')).toBe(null);
    expect(intentOf('Also send a welcome email through Gmail')).toBe(null);
    expect(intentOf('Approved')).toBe(null);
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
