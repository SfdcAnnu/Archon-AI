/**
 * Whether a chat streams: who decides, and in what order.
 *
 * Three things can have an opinion, and they are NOT equal:
 *
 *   1. The person in the chat. If they have touched the toggle for this
 *      agent in this browser, that wins. Always. Including when it
 *      contradicts the agent's setting — turning it off on an agent that
 *      ships with it on is the whole point of the control existing.
 *   2. The agent. Its Stream Replies checkbox is where a conversation
 *      STARTS, not what it is locked to. The Metadata Expert ships with it
 *      on because its turns are long and silent; most agents do not.
 *   3. The platform. Off.
 *
 * Stored per agent rather than globally, because "stream the agent that
 * spends two minutes in tools" and "do not stream the one that answers in
 * a sentence" is a reasonable thing to want at the same time.
 *
 * Every accessor is wrapped: localStorage throws in a private window and
 * can come back with anything, and a preference that cannot be read is a
 * missing convenience, never a reason to fail.
 */

const KEY_PREFIX = 'archon:stream:';

/** What this browser's owner chose for this agent, if they chose at all. */
export function getStreamOverride(agentApiName: string): boolean | null {
  try {
    const v = localStorage.getItem(KEY_PREFIX + agentApiName);
    return v === 'on' ? true : v === 'off' ? false : null;
  } catch {
    return null;
  }
}

export function setStreamOverride(agentApiName: string, on: boolean): void {
  try {
    localStorage.setItem(KEY_PREFIX + agentApiName, on ? 'on' : 'off');
  } catch {
    /* private mode — the choice lasts for this chat only */
  }
}

/** Hand back to the agent's own setting. */
export function clearStreamOverride(agentApiName: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + agentApiName);
  } catch {
    /* nothing to undo */
  }
}

/** The rule in the module doc, in one line. */
export function resolveStreaming(agentApiName: string, agentDefault: boolean | undefined): boolean {
  const chosen = getStreamOverride(agentApiName);
  return chosen ?? agentDefault ?? false;
}

export const STREAM_LABEL = {
  on: 'Live streaming on — tools narrated, reply appears as it is written',
  off: 'Live streaming off — the reply arrives all at once',
} as const;
