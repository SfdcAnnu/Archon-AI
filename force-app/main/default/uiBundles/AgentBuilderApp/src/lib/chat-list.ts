import type { SessionSummary } from './conversations-data';

/**
 * The Chat page's sidebar is one agent's conversations, newest first,
 * each with its status and the time of its last turn — the same shape
 * Claude's and ChatGPT's sidebars have. These are the pure pieces of
 * that: when a turn happened in words, which day-group a session falls
 * in, and how the picker orders agents. Nothing here touches the network,
 * so it is tested against fixed clocks.
 */

export type DayGroup = 'Today' | 'Yesterday' | 'Earlier';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "just now", "12 min ago", "7:45 PM", "Mon", "17 Sep", "3 Jan 2025". */
export function formatLastTurn(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const diff = now.getTime() - t.getTime();
  if (diff >= 0 && diff < MIN) return 'just now';
  if (diff >= 0 && diff < 60 * MIN) return `${Math.floor(diff / MIN)} min ago`;
  if (startOfDay(t) === startOfDay(now)) return clock(t);
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days > 0 && days < 7) return WEEKDAY[t.getDay()];
  const base = `${t.getDate()} ${MONTH[t.getMonth()]}`;
  return t.getFullYear() === now.getFullYear() ? base : `${base} ${t.getFullYear()}`;
}

export function dayGroupOf(iso: string | null | undefined, now: Date = new Date()): DayGroup {
  if (!iso) return 'Earlier';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return 'Earlier';
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return 'Earlier';
}

const byLastTurnDesc = (a: SessionSummary, b: SessionSummary): number => {
  const ta = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
  const tb = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
  return tb - ta;
};

/** One agent's sessions, newest first. */
export function sessionsForAgent(sessions: SessionSummary[], agentApiName: string): SessionSummary[] {
  return sessions.filter(s => s.agentApiName === agentApiName).sort(byLastTurnDesc);
}

/** Today / Yesterday / Earlier, in that order, empty groups left out. */
export function groupSessionsByDay(
  sessions: SessionSummary[],
  now: Date = new Date(),
): Array<{ label: DayGroup; sessions: SessionSummary[] }> {
  const order: DayGroup[] = ['Today', 'Yesterday', 'Earlier'];
  const buckets = new Map<DayGroup, SessionSummary[]>(order.map(g => [g, []]));
  for (const s of [...sessions].sort(byLastTurnDesc)) buckets.get(dayGroupOf(s.lastActivityAt, now))!.push(s);
  return order.filter(g => buckets.get(g)!.length > 0).map(g => ({ label: g, sessions: buckets.get(g)! }));
}

export interface AgentChatStats { count: number; last: string | null }

/** Per agent: how many chats, and when the latest one last moved. */
export function agentStats(sessions: SessionSummary[]): Map<string, AgentChatStats> {
  const out = new Map<string, AgentChatStats>();
  for (const s of sessions) {
    const cur = out.get(s.agentApiName) ?? { count: 0, last: null };
    cur.count += 1;
    if (s.lastActivityAt && (!cur.last || new Date(s.lastActivityAt) > new Date(cur.last))) cur.last = s.lastActivityAt;
    out.set(s.agentApiName, cur);
  }
  return out;
}

/** Built-in agents first, then by most recent chat, then by name. */
export function sortAgentsForPicker<T extends { apiName: string; name: string; isSystem?: boolean }>(
  agents: T[],
  stats: Map<string, AgentChatStats>,
): T[] {
  const last = (a: T) => { const l = stats.get(a.apiName)?.last; return l ? new Date(l).getTime() : 0; };
  return [...agents].sort((a, b) =>
    Number(!!b.isSystem) - Number(!!a.isSystem) || last(b) - last(a) || a.name.localeCompare(b.name));
}

/** "AC" for Archon Copilot, "W" for WhatsApp Lead Intake Qualifier: the
 *  first letters of the first two words, or one letter for a one-word name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0].slice(0, 1) + words[1].slice(0, 1)).toUpperCase();
}
