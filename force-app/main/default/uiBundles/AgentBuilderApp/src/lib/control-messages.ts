/**
 * Messages the SCREEN sends in the person's name — a build card's button,
 * a build that ended, a return from another agent. The model needs their
 * full text; the person does not need to read machine text in their own
 * bubble. So the transcript shows a short chip in their place.
 *
 * The prefixes are the contract with the copilot's instructions
 * (server-langchain/src/platform/agents/archon-copilot.ts): "[Update] …",
 * "[Back from <agent>] …" and "Build <id>…".
 */
export interface ControlChip {
  /** What the chip says. */
  label: string;
  /** 'you' — a choice the person made on the screen; 'event' — the app reporting. */
  kind: 'you' | 'event';
}

/** A build update the chat sends to the copilot when a build it started ends. */
export const UPDATE_PREFIX = '[Update] ';
/** The message the copilot gets when the person comes back from another agent. */
export const backFromPrefix = (agentName: string) => `[Back from ${agentName}] `;

export function controlChip(text: string | null | undefined): ControlChip | null {
  const t = (text ?? '').trim();
  if (!t) return null;

  if (t.startsWith(UPDATE_PREFIX.trim())) {
    const body = t.slice(UPDATE_PREFIX.length).trim();
    if (/^The Architect has built|saved it as|build .*finished/i.test(body)) return { label: 'Build finished', kind: 'event' };
    if (/stopped|failed/i.test(body)) return { label: 'Build stopped', kind: 'event' };
    if (/paused/i.test(body)) return { label: 'Build paused', kind: 'event' };
    return { label: 'Update', kind: 'event' };
  }
  const back = /^\[Back from ([^\]]+)\]/.exec(t);
  if (back) return { label: `Back from ${back[1]}`, kind: 'event' };

  if (!/^Build [A-Za-z0-9-]{8,}/.test(t)) return null;
  if (/answers to your questions/i.test(t)) {
    const answered = (t.match(/^\s*\d+\.\s/gm) ?? []).length;
    const kind = /Agent type:\s*(\w+)/i.exec(t)?.[1];
    const parts = [answered ? `answered ${answered} question${answered === 1 ? '' : 's'}` : 'answered the questions'];
    if (kind) parts.push(`${kind.toLowerCase()} agent`);
    return { label: `You ${parts.join(' · ')}`, kind: 'you' };
  }
  if (/every gap is decided/i.test(t)) return { label: 'Continue to the design', kind: 'you' };
  if (/continue to the next stage/i.test(t)) return { label: 'Next stage', kind: 'you' };
  if (/run all the remaining stages/i.test(t)) return { label: 'Run the remaining stages', kind: 'you' };
  if (/resume from where it paused/i.test(t)) return { label: 'Resume the build', kind: 'you' };
  if (/fix what the review found/i.test(t)) return { label: 'Fix what the review found', kind: 'you' };
  if (/accept the review/i.test(t)) return { label: 'Accept the review and continue', kind: 'you' };
  if (/setup|gaps?|prerequisite/i.test(t)) return { label: 'Continue with the setup list', kind: 'you' };
  return { label: 'Build control', kind: 'you' };
}
