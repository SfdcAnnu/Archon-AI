import { describe, it, expect } from 'vitest';
import {
  agentStats, dayGroupOf, formatLastTurn, groupSessionsByDay, initials, sessionsForAgent, sortAgentsForPicker,
} from './chat-list';
import type { SessionSummary } from './conversations-data';

// Local-time constructors throughout: the page shows the person's own
// clock, and an ISO string parsed in a different zone would move a
// session across midnight in the test but not on the screen.
const now = new Date(2026, 8, 23, 19, 50, 30);             // Wed 23 Sep 2026, 7:50:30 PM
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).toISOString();

const session = (over: Partial<SessionSummary>): SessionSummary => ({
  id: 'a08', name: 'CS-1', agentName: 'WhatsApp Lead Intake Qualifier', agentApiName: 'whatsapp_lead_intake_qualifier',
  title: 'Hello', status: 'Ended', lastActivityAt: null, expiresAt: null, totalTurns: 4, recordContextId: null,
  tokensIn: null, tokensOut: null, cachedTokens: null, latencyMsTotal: null, usageByModelJson: null, ...over,
});

describe('formatLastTurn', () => {
  it('reads like a chat sidebar', () => {
    expect(formatLastTurn(at(2026, 8, 23, 19, 50), now)).toBe('just now');   // 30 s ago
    expect(formatLastTurn(at(2026, 8, 23, 19, 49), now)).toBe('1 min ago');  // 90 s ago: a minute, not "just now"
    expect(formatLastTurn(at(2026, 8, 23, 19, 38), now)).toBe('12 min ago');
    expect(formatLastTurn(at(2026, 8, 23, 7, 45), now)).toBe('7:45 AM');
    expect(formatLastTurn(at(2026, 8, 23, 12, 5), now)).toBe('12:05 PM');
    expect(formatLastTurn(at(2026, 8, 21, 17, 12), now)).toBe('Mon');
    expect(formatLastTurn(at(2026, 8, 3, 9, 0), now)).toBe('3 Sep');
    expect(formatLastTurn(at(2025, 0, 3, 9, 0), now)).toBe('3 Jan 2025');
  });
  it('is empty for nothing and for garbage', () => {
    expect(formatLastTurn(null, now)).toBe('');
    expect(formatLastTurn('not a date', now)).toBe('');
  });
});

describe('dayGroupOf', () => {
  it('splits Today, Yesterday, Earlier on the calendar, not on 24-hour windows', () => {
    expect(dayGroupOf(at(2026, 8, 23, 0, 5), now)).toBe('Today');       // 19h45m ago, still today
    expect(dayGroupOf(at(2026, 8, 22, 23, 55), now)).toBe('Yesterday'); // 19h55m ago, yesterday
    expect(dayGroupOf(at(2026, 8, 21, 19, 50), now)).toBe('Earlier');
    expect(dayGroupOf(null, now)).toBe('Earlier');
  });
});

describe('sessionsForAgent + groupSessionsByDay', () => {
  const list = [
    session({ id: '1', lastActivityAt: at(2026, 8, 23, 19, 45) }),
    session({ id: '2', lastActivityAt: at(2026, 8, 22, 18, 0) }),
    session({ id: '3', lastActivityAt: at(2026, 8, 23, 19, 48), status: 'Active' }),
    session({ id: '4', agentApiName: 'archon_copilot', agentName: 'Archon Copilot', lastActivityAt: at(2026, 8, 23, 19, 49) }),
    session({ id: '5', lastActivityAt: at(2026, 8, 10, 9, 0) }),
    session({ id: '6', lastActivityAt: null }),
  ];
  it('keeps only that agent, newest first', () => {
    expect(sessionsForAgent(list, 'whatsapp_lead_intake_qualifier').map(s => s.id)).toEqual(['3', '1', '2', '5', '6']);
  });
  it('groups in reading order and drops empty groups', () => {
    const groups = groupSessionsByDay(sessionsForAgent(list, 'whatsapp_lead_intake_qualifier'), now);
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', 'Earlier']);
    expect(groups[0].sessions.map(s => s.id)).toEqual(['3', '1']);
    expect(groups[2].sessions.map(s => s.id)).toEqual(['5', '6']);
    expect(groupSessionsByDay(sessionsForAgent(list, 'archon_copilot'), now).map(g => g.label)).toEqual(['Today']);
  });
});

describe('agentStats + sortAgentsForPicker', () => {
  const list = [
    session({ id: '1', lastActivityAt: at(2026, 8, 23, 19, 45) }),
    session({ id: '2', lastActivityAt: at(2026, 8, 22, 18, 0) }),
    session({ id: '3', agentApiName: 'sales_desk_assistant', agentName: 'Sales Desk Assistant', lastActivityAt: at(2026, 8, 23, 19, 49) }),
  ];
  it('counts chats and keeps the latest turn per agent', () => {
    const stats = agentStats(list);
    expect(stats.get('whatsapp_lead_intake_qualifier')).toEqual({ count: 2, last: at(2026, 8, 23, 19, 45) });
    expect(stats.get('sales_desk_assistant')?.count).toBe(1);
    expect(stats.has('archon_copilot')).toBe(false);
  });
  it('puts built-ins first, then the most recently used, then the rest by name', () => {
    const agents = [
      { apiName: 'whatsapp_lead_intake_qualifier', name: 'WhatsApp Lead Intake Qualifier' },
      { apiName: 'noida_real_estate_sales_assistant', name: 'Noida Real Estate Sales Assistant' },
      { apiName: 'sales_desk_assistant', name: 'Sales Desk Assistant' },
      { apiName: 'archon_copilot', name: 'Archon Copilot', isSystem: true },
      { apiName: 'metadata_expert', name: 'Metadata Expert', isSystem: true },
    ];
    expect(sortAgentsForPicker(agents, agentStats(list)).map(a => a.apiName)).toEqual([
      'archon_copilot', 'metadata_expert', 'sales_desk_assistant', 'whatsapp_lead_intake_qualifier', 'noida_real_estate_sales_assistant',
    ]);
  });
});

describe('initials', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Archon Copilot')).toBe('AC');
    expect(initials('WhatsApp Lead Intake Qualifier')).toBe('WL');
    expect(initials('Metadata')).toBe('M');
    expect(initials('  ')).toBe('?');
  });
});
