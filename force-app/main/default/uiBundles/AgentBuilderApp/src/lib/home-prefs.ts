/**
 * What the Home page remembers per browser: whether this tab has already
 * seen the full entrance.
 *
 * The copilot that answers on Home is always Archon itself — there is no
 * agent choice to remember any more. Portal-built agents are talked to on
 * the Chat page.
 *
 * A convenience, not state — storage can be blocked or cleared and the page
 * must still work, so every access is guarded.
 */
const INTRO_KEY = 'archon:home-intro-seen';

/** The full cinematic entrance plays once per tab session; later visits
 *  get a quick version so a frequent visitor is never made to wait. */
export function introMode(): 'full' | 'short' {
  try {
    if (sessionStorage.getItem(INTRO_KEY)) return 'short';
    sessionStorage.setItem(INTRO_KEY, '1');
    return 'full';
  } catch {
    return 'short';
  }
}
