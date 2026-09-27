import { useCallback, useEffect, useRef, useState } from 'react';
import { stripWake, WAKE_RE } from '@/lib/archon-intent';

/**
 * "Hey Archon" from anywhere on the page.
 *
 * The browser's speech recognition runs continuously while the person has
 * switched it on, and the moment a phrase starts with the wake word the
 * rest of it is handed over. Nothing said before the wake word leaves the
 * browser: recognition is local to the page and no transcript is kept.
 *
 * The choice is remembered per browser, but a fresh page cannot start a
 * microphone without a gesture, so a remembered "on" is a request the
 * page makes once the person has interacted with it.
 */
const WAKE_PREF = 'archon:wake';

export function getWakePref(): boolean {
  try { return localStorage.getItem(WAKE_PREF) === 'on'; } catch { return false; }
}
export function setWakePref(on: boolean): void {
  try { localStorage.setItem(WAKE_PREF, on ? 'on' : 'off'); } catch { /* private mode */ }
}

// The ambient Web Speech types are declared in speech-recognition.d.ts;
// derived here from Window so the linter sees no bare globals.
type Recognition = InstanceType<NonNullable<Window['SpeechRecognition']>>;
type ResultEvent = Parameters<NonNullable<Recognition['onresult']>>[0];
type ErrorEvent = Parameters<NonNullable<Recognition['onerror']>>[0];

export interface WakeWordState {
  supported: boolean;
  listening: boolean;
  /** Why the microphone is not listening, when it should be. */
  error: string | null;
  /** The last few words heard, for the bar's readout. */
  heard: string;
  start: () => void;
  stop: () => void;
}

export function useWakeWord(onWake: (rest: string) => void): WakeWordState {
  const supported = typeof window !== 'undefined' && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState('');
  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);
  const onWakeRef = useRef(onWake);
  useEffect(() => { onWakeRef.current = onWake; }, [onWake]);

  const stop = useCallback(() => {
    wantRef.current = false;
    setWakePref(false);
    const r = recRef.current;
    recRef.current = null;
    if (r) { try { r.onend = null; r.stop(); } catch { /* already stopped */ } }
    setListening(false);
    setHeard('');
  }, []);

  const start = useCallback(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor || recRef.current) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';
    r.onresult = (ev: ResultEvent) => {
      let text = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) text += ev.results[i][0].transcript;
      const trimmed = text.trim();
      setHeard(trimmed.slice(-60));
      if (!WAKE_RE.test(trimmed)) return;
      // Hand over once the phrase after the name has settled — a final
      // result, or a pause long enough that the recogniser stopped adding.
      const last = ev.results[ev.results.length - 1];
      const rest = stripWake(trimmed);
      if (last.isFinal || rest.length > 0) {
        wantRef.current = false;
        recRef.current = null;
        try { r.onend = null; r.stop(); } catch { /* fine */ }
        setListening(false);
        setHeard('');
        onWakeRef.current(rest);
      }
    };
    r.onerror = (ev: ErrorEvent) => {
      // "no-speech" and "aborted" are the recogniser's idle timeouts; the
      // onend handler restarts it. Anything else is worth telling the person.
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      setError(ev.error === 'not-allowed' ? 'Microphone access was declined' : `Microphone: ${ev.error}`);
      wantRef.current = false;
      recRef.current = null;
      setListening(false);
    };
    r.onend = () => {
      // Browsers stop a continuous session every minute or so; keep going
      // while the person still wants it.
      if (!wantRef.current || recRef.current !== r) return;
      try { r.start(); } catch { recRef.current = null; setListening(false); }
    };
    try {
      r.start();
      recRef.current = r;
      wantRef.current = true;
      setWakePref(true);
      setError(null);
      setListening(true);
    } catch {
      setError('Could not start the microphone');
    }
  }, []);

  // Stop cleanly when the page that owns the hook goes away.
  useEffect(() => () => {
    wantRef.current = false;
    const r = recRef.current;
    recRef.current = null;
    if (r) { try { r.onend = null; r.stop(); } catch { /* fine */ } }
  }, []);

  return { supported, listening, error, heard, start, stop };
}
