import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveStreaming, getStreamOverride, setStreamOverride, clearStreamOverride,
} from './stream-pref';

/**
 * The precedence rule is the whole feature. Every case below is a thing
 * someone asked for out loud:
 *   - streaming is off unless something turns it on
 *   - an agent can ship with it on
 *   - the person in the chat overrides the agent, in BOTH directions
 */
describe('resolveStreaming', () => {
  beforeEach(() => localStorage.clear());

  it('is off when nobody has an opinion', () => {
    expect(resolveStreaming('sales_desk', undefined)).toBe(false);
  });

  it('is off when the agent says off', () => {
    expect(resolveStreaming('sales_desk', false)).toBe(false);
  });

  it('is on when the agent ships with it on', () => {
    // The Metadata Expert's case: long, quiet turns.
    expect(resolveStreaming('metadata_expert', true)).toBe(true);
  });

  it('lets a person turn it on for an agent that ships with it off', () => {
    setStreamOverride('sales_desk', true);
    expect(resolveStreaming('sales_desk', false)).toBe(true);
  });

  it('lets a person turn it OFF for an agent that ships with it on', () => {
    setStreamOverride('metadata_expert', false);
    expect(resolveStreaming('metadata_expert', true)).toBe(false);
  });

  it('keeps each agent’s choice separate', () => {
    setStreamOverride('metadata_expert', false);
    setStreamOverride('sales_desk', true);
    expect(resolveStreaming('metadata_expert', true)).toBe(false);
    expect(resolveStreaming('sales_desk', false)).toBe(true);
  });

  it('hands back to the agent once a person clears their choice', () => {
    setStreamOverride('metadata_expert', false);
    clearStreamOverride('metadata_expert');
    expect(getStreamOverride('metadata_expert')).toBeNull();
    expect(resolveStreaming('metadata_expert', true)).toBe(true);
  });

  it('treats a stale or corrupted value as no opinion, not as on', () => {
    localStorage.setItem('archon:stream:sales_desk', 'yes please');
    expect(getStreamOverride('sales_desk')).toBeNull();
    expect(resolveStreaming('sales_desk', false)).toBe(false);
  });

  it('does not confuse one agent with another whose name starts the same', () => {
    setStreamOverride('metadata_expert', true);
    expect(getStreamOverride('metadata_expert_v2')).toBeNull();
  });
});
