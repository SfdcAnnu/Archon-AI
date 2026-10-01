/**
 * The few things the Archon screen does from the person's own words,
 * without a model call.
 *
 * Whether a view opens beside the conversation — today's dashboard, a
 * list, a chart — is the copilot's decision: it calls show_on_screen when
 * a view answers better than words, and the result carries the rows the
 * view shows. The page used to guess that from phrases ("what … today"
 * opened the dashboard for "what can you do for me today"); it no longer
 * does. What stays here is not a guess about meaning: closing what is
 * showing, and keeping a request for a new agent tidy on the screen.
 */
export type ArchonIntent =
  | 'close'      // done, thanks, go back — the surface closes
  | 'build'      // build a new agent (the Architect)
  | 'build-back' // show the build / the graph again
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
  if (/\b(build|create|design|make)\b.*\b(agent|bot|assistant|copilot|component|workflow|automation)\b|\bnew (agent|component)\b/.test(t)) return 'build';
  // Describing an agent is a request for one, whatever words the
  // description uses ("an agent that shows opportunity activities").
  if (/\bagents?\b/.test(t) && /\b(i want|i need|we need|want (a|an|one|single)|need (a|an|one)|single agent|agents? (that|which|who|to|for)|should|will show|that will)\b/.test(t)) return 'build';
  if (/\b(open|show|see|go to|back to)\b.*\b(agent|build|studio|graph|design)\b/.test(t)) return 'build-back';
  return null;
}

/** Whether a message is a change to the agent being built rather than a
 *  request for another one — "make it an automation agent as well" edits,
 *  "build a support agent" starts afresh. */
export function editsCurrentBuild(text: string): boolean {
  return /\b(it|this|that|the agent|the build|the graph)\b/i.test(text);
}
