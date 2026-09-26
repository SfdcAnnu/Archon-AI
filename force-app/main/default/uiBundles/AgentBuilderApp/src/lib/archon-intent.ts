/**
 * What shape an answer needs, read from the person's own words.
 *
 * Archon answers every message in the conversation; this decides whether
 * the screen should also divide and show something beside it — today's
 * dashboard, a list, a chart, the build — or close what is showing. It is
 * deliberately a small, readable set of phrases rather than a model call:
 * it runs on every send, costs nothing, and a miss only means the answer
 * arrives in words alone, which is never wrong.
 */
export type ArchonIntent =
  | 'close'      // done, thanks, go back — the surface closes
  | 'failures'   // what failed today
  | 'drafts'     // agents still in Draft
  | 'approvals'  // what is waiting for a decision
  | 'chart'      // a chart of cost or usage
  | 'usage'      // the usage report: turns, tokens and spend per agent
  | 'dash'       // today as a dashboard
  | 'build'      // build a new agent (the Architect)
  | 'build-back' // show the build / the graph again
  | 'how'        // how is an agent doing — words are enough
  | null;

/** "Hey Archon" (or hello / hi / ok / okay) at the start of what was heard,
 *  with any punctuation the recogniser put after the name. */
export const WAKE_RE = /^\s*(?:hey|hello|hi|ok|okay)[\s,]+archon\b[\s,.!?:-]*/i;

export function stripWake(text: string): string {
  return text.replace(WAKE_RE, '').trim();
}

export function intentOf(text: string): ArchonIntent {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^(close|done|that'?s all|thanks|thank you|go back|back to the conversation|clear|nothing else|dismiss)\b/.test(t)) return 'close';
  // A request for a new agent first: what it should do may mention
  // failures, reports or approvals without asking to see them.
  if (/\b(build|create|design|make)\b.*\b(agent|bot|assistant|copilot|component|workflow|automation)\b|\bnew (agent|component)\b/.test(t)) return 'build';
  // Describing an agent is not asking to see data, whatever words the
  // description uses ("an agent that shows opportunity activities").
  if (/\bagents?\b/.test(t) && /\b(i want|i need|we need|want (a|an|one|single)|need (a|an|one)|single agent|agents? (that|which|who|to|for)|should|will show|that will)\b/.test(t)) return 'build';
  if (/\b(fail|failed|failure|failures|error|errors|broke|broken|went wrong)\b/.test(t)) return 'failures';
  if (/\bdrafts?\b/.test(t)) return 'drafts';
  // Asking to SEE what is waiting — not "approved", "I approve it", or an
  // agent that should wait for approval.
  if (/\bapprov/.test(t) && /\b(waiting|pending|queue|show|list|open|any|what|which|how many|need my|needs my)\b/.test(t) && !/\b(meeting|event|book|booking)\b/.test(t)) return 'approvals';
  if (/\b(chart|graph of|cost by|compare|breakdown|spend|spending|usage by)\b/.test(t)) return 'chart';
  if (/\b(usage|report|tokens?|token usage|consumption)\b|\bhow much\b.*\b(used|spent|cost|consumed)\b/.test(t)) return 'usage';
  if (/\b(how (is|are) .*(doing|going)|status of|is .* (ok|okay|fine|healthy))\b/.test(t)) return 'how';
  // Today as a dashboard only when that is what is asked for — not every
  // sentence that says "activity" or "today".
  if (/\b(what happened|briefing|dashboard|overview|command cent(er|re))\b/.test(t) || /^(what|how)\b.*\btoday\b/.test(t)) return 'dash';
  if (/\b(open|show|see|go to|back to)\b.*\b(agent|build|studio|graph|design)\b/.test(t)) return 'build-back';
  return null;
}

/** Whether a message is a change to the agent being built rather than a
 *  request for another one — "make it an automation agent as well" edits,
 *  "build a support agent" starts afresh. */
export function editsCurrentBuild(text: string): boolean {
  return /\b(it|this|that|the agent|the build|the graph)\b/i.test(text);
}
