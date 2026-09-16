import { useEffect, useState } from 'react';

/**
 * Voice for the chat panel: the agent speaking back, and two remembered
 * preferences. Speech-to-text stays where it is (the browser's
 * SpeechRecognition in ChatPanel); this file is the other direction.
 *
 * There are no modes. The mic and the text box are both live on every
 * turn. The only rule is that the agent ANSWERS IN KIND — aloud if you
 * spoke, text if you typed — and the only control is the sound preference
 * below, which can force that either way.
 */
export type SoundPref = 'auto' | 'always' | 'off';

const SOUND_KEY = 'archon:sound';
const VOICE_KEY = 'archon:voice';
const EVENT = 'archon:speaking';

export function getSoundPref(): SoundPref {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return v === 'always' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}
export function setSoundPref(v: SoundPref): void {
  try { localStorage.setItem(SOUND_KEY, v); } catch { /* private mode */ }
}

/** Whether the mic arms itself when the panel opens. Set the first time a
 *  person taps the mic on; cleared when they tap it off. Browsers will not
 *  start listening without a gesture on a fresh page, so this is a request
 *  the panel makes, not a guarantee. */
export function getVoicePref(): boolean {
  try { return localStorage.getItem(VOICE_KEY) === 'on'; } catch { return false; }
}
export function setVoicePref(on: boolean): void {
  try { localStorage.setItem(VOICE_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
}

export const SOUND_LABEL: Record<SoundPref, string> = {
  auto: 'Read aloud when I speak',
  always: 'Read aloud always',
  off: 'Read aloud off',
};
export function nextSoundPref(v: SoundPref): SoundPref {
  return v === 'auto' ? 'always' : v === 'always' ? 'off' : 'auto';
}

// ── text-to-speech ───────────────────────────────────────────────────
let speakingNow = false;
function announce(on: boolean): void {
  speakingNow = on;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

/** Replies are markdown; a voice should not read the asterisks. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code omitted. ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\|/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  if (speakingNow) announce(false);
}

/** Speak, resolving when finished. Resolves immediately where the browser
 *  has no voice, so callers never wait on a feature that is not there. */
export function speak(text: string): Promise<void> {
  return new Promise(resolve => {
    if (typeof speechSynthesis === 'undefined' || !text) { resolve(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    const done = () => { announce(false); resolve(); };
    u.onend = done;
    u.onerror = done;
    announce(true);
    speechSynthesis.speak(u);
    // Some browsers never fire onend once the tab loses focus — never leave
    // the panel stuck on "speaking".
    setTimeout(() => { if (speakingNow) { speechSynthesis.cancel(); done(); } }, Math.min(60_000, 4_000 + text.length * 70));
  });
}

export function useSpeaking(): boolean {
  const [on, set] = useState(speakingNow);
  useEffect(() => {
    const h = (e: Event) => set((e as CustomEvent<boolean>).detail);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  return on;
}
