import { describe, expect, it } from 'vitest';
import { parseScreen } from './archon-screen';

describe('parseScreen', () => {
  it('reads the view from the tool result text, ignoring the line after the JSON', () => {
    const out = '{"screen":{"view":"dashboard","days":null,"agentApiName":null}}\nSHOWN: the dashboard view is on the screen.';
    expect(parseScreen(out)).toEqual({ view: 'dashboard', days: null, agentApiName: null });
  });
  it('carries the usage rows the copilot was shown', () => {
    const out = JSON.stringify({ screen: { view: 'usage', days: 31, agentApiName: null }, usage: { days: 31, turns: 231, tokensIn: 1, tokensOut: 2, byAgent: [{ apiName: 'a', name: 'Agent A', turns: 173, tokensIn: 984403, tokensOut: 61200 }, { apiName: '', name: 'ghost', turns: 1, tokensIn: 1, tokensOut: 1 }] } });
    const r = parseScreen(out);
    expect(r?.view).toBe('usage');
    expect(r?.usage?.source).toBe('archon');
    expect(r?.usage?.rows).toEqual([{ apiName: 'a', name: 'Agent A', turns: 173, tokensIn: 984403, tokensOut: 61200 }]);
  });
  it('accepts a structured object as well as text', () => {
    expect(parseScreen({ screen: { view: 'failures' } })?.view).toBe('failures');
  });
  it('refuses anything that is not a known view', () => {
    expect(parseScreen('{"screen":{"view":"kitchen"}}')).toBeNull();
    expect(parseScreen('Error: no')).toBeNull();
    expect(parseScreen(undefined)).toBeNull();
  });
});
