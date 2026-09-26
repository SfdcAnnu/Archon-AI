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
  if (/\b(fail|failed|failure|failures|error|errors|broke|broken|went wrong)\b/.test(t)) return 'failures';
  if (/\bdrafts?\b/.test(t)) return 'drafts';
  if (/\bapprov/.test(t) && !/\b(meeting|event|book|booking)\b/.test(t)) return 'approvals';
  if (/\b(chart|graph of|cost by|compare|breakdown|spend|spending|usage by)\b/.test(t)) return 'chart';
  if (/\b(how (is|are) .*(doing|going)|status of|is .* (ok|okay|fine|healthy))\b/.test(t)) return 'how';
  if (/\b(today|activity|activities|briefing|dashboard|summary|what happened|overview|command cent(er|re))\b/.test(t)) return 'dash';
  if (/\b(build|create|design|make)\b.*\b(agent|bot|assistant|copilot|component|workflow|automation)\b|\bnew (agent|component)\b/.test(t)) return 'build';
  if (/\b(open|show|see|go to|back to)\b.*\b(agent|build|studio|graph|design)\b/.test(t)) return 'build-back';
  return null;
}

/** Whether a message is a change to the agent being built rather than a
 *  request for another one — "make it an automation agent as well" edits,
 *  "build a support agent" starts afresh. */
export function editsCurrentBuild(text: string): boolean {
  return /\b(it|this|that|the agent|the build|the graph)\b/i.test(text);
}
