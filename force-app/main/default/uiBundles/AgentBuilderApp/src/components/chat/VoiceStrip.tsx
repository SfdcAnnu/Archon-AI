/**
 * What the agent is doing right now, in one line — the chat panel's
 * version of the HUD's status readout.
 *
 *   LISTENING  the mic is open; it sends when you pause
 *   THINKING   a turn is in flight
 *   SPEAKING   the reply is being read aloud
 *   READY      nothing in flight; type or talk
 *
 * A person glancing at the panel should know which of those is true
 * without reading the transcript. The waveform is the same idea as the
 * label, for the corner of the eye.
 */
export type VoicePhase = 'listen' | 'think' | 'speak' | 'ready';

const COPY: Record<VoicePhase, [string, string]> = {
  listen: ['Listening', 'it sends when you pause'],
  think: ['Thinking', 'working on it'],
  speak: ['Speaking', 'start talking or typing to interrupt'],
  ready: ['Ready', 'type or talk — both are live'],
};

export function VoiceStrip({ phase, voiceSupported }: { phase: VoicePhase; voiceSupported: boolean }) {
  const [label, hint] = COPY[phase];
  return (
    <div className="chat-vstrip" data-phase={phase} aria-live="polite">
      <span className="chat-vstrip-dot" />
      <span className="chat-vstrip-label">{label}</span>
      <span className="chat-vstrip-hint">{voiceSupported ? hint : 'voice input is not available in this browser'}</span>
      <span className="chat-wave" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => <i key={i} />)}
      </span>
    </div>
  );
}

/** The small phase ring for the panel header — the HUD core, sized for a
 *  side panel. Colour and motion are driven by the same phase. */
export function PhaseRing({ phase }: { phase: VoicePhase }) {
  return (
    <span className="chat-ring" data-phase={phase} aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <circle className="chat-ring-a" cx="20" cy="20" r="17" />
        <circle className="chat-ring-b" cx="20" cy="20" r="12" />
      </svg>
    </span>
  );
}
