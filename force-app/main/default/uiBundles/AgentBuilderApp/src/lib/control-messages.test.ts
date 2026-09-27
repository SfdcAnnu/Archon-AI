import { describe, expect, it } from 'vitest';
import { backFromPrefix, controlChip, UPDATE_PREFIX } from './control-messages';

/** Messages the screen sends in the person's name show as a short chip,
 *  never as a bubble of machine text. Everything the person types stays a
 *  normal message. */
describe('controlChip', () => {
  it('turns the answers button into "You answered N questions"', () => {
    const text = 'Build 496c4175-e8dd-42d1-aa08-2d49d075ba8c — answers to your questions:\nAgent type: automation\n1. Assumption: x\n   → You decide\n2. Assumption: y\n   → You decide\nFold these into the requirement and continue.';
    expect(controlChip(text)).toEqual({ label: 'You answered 2 questions · automation agent', kind: 'you' });
  });

  it('names each build card button', () => {
    expect(controlChip('Build 3f384da6-86a2-4991-bcf5-49e2a732d602: continue to the next stage.')?.label).toBe('Next stage');
    expect(controlChip('Build cff62bde-a602-4b3a-8690-1146fd9f97e7: accept the review risk as it is and continue.')?.label).toBe('Accept the review and continue');
    expect(controlChip('Build 7130a50c-197d-404c-9bee-74f8f6144c5b: fix what the review found: "x"')?.label).toBe('Fix what the review found');
    expect(controlChip('Build 7130a50c-197d-404c-9bee-74f8f6144c5b: every gap is decided, continue to the design.')?.label).toBe('Continue to the design');
  });

  it('shows the app\'s own events as events', () => {
    expect(controlChip(`${UPDATE_PREFIX}The Architect has built **x** as a chat agent and saved it as Draft.`)).toEqual({ label: 'Build finished', kind: 'event' });
    expect(controlChip(`${UPDATE_PREFIX}The build stopped after 7 of 8 stages: boom. Nothing was created.`)?.label).toBe('Build stopped');
    expect(controlChip(`${backFromPrefix('Metadata Expert')}Created 3 fields.`)).toEqual({ label: 'Back from Metadata Expert', kind: 'event' });
  });

  it('leaves what the person typed alone', () => {
    expect(controlChip('Build me an agent that follows up on deals')).toBeNull();
    expect(controlChip('activate it please')).toBeNull();
    expect(controlChip('')).toBeNull();
  });
});
