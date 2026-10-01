import { Mic, Play } from 'lucide-react';
import type { WakeWordState } from '@/hooks/useWakeWord';

/**
 * The Archon bar at the foot of Home. Left: the voice-wake switch. Centre:
 * Talk to Archon. Right: today's briefing. Tapping, typing or "Hey Archon"
 * all lead to the same place — the full-screen conversation — so the bar
 * carries no composer and no numbers of its own; the dashboard above
 * already shows those.
 */
export interface ArchonBarProps {
  /** Approvals waiting on the person: the bar's edge says so. */
  pending: number;
  wake: WakeWordState;
  onTalk: () => void;
  onBrief: () => void;
}

const Wave = () => (
  <span className="ax-jw" aria-hidden="true">
    <i /><i /><i /><i /><i /><i /><i />
  </span>
);

export function ArchonBar({ pending, wake, onTalk, onBrief }: ArchonBarProps) {
  const voiceLine = !wake.supported
    ? 'Not in this browser'
    : wake.error ?? (wake.listening ? (wake.heard ? `“${wake.heard}”` : 'Listening') : 'Off');
  return (
    <div className={`ax-bar${wake.listening ? ' voice' : ''}`} data-waiting={pending > 0 ? '1' : '0'} role="region" aria-label="Archon">
      {/* Three columns, the outer two equal: the pill sits at the exact
          centre of the bar however wide the voice tile or the briefing
          button happen to be. */}
      <div className="ax-bar-l">
        <div className="ax-bar-tiles">
          <button
            type="button"
            className={`ax-bt tog${wake.listening ? ' on' : ''}`}
            onClick={wake.listening ? wake.stop : wake.start}
            disabled={!wake.supported}
            aria-pressed={wake.listening}
            title={wake.supported ? 'Listen for “Hey Archon” on this page' : 'Speech recognition is not available in this browser'}
          >
            <Mic /><span><small>Voice wake</small><b>{voiceLine}</b></span>
          </button>
        </div>
        <div className="ax-dots" aria-hidden="true" />
      </div>
      <button type="button" className="ax-talk" onClick={onTalk}>
        <Wave />
        <span className="tt"><b>Talk to Archon</b><small>{wake.listening ? 'Listening for “Hey Archon”…' : 'Say “Hey Archon” or tap'}</small></span>
        <Wave />
      </button>
      <div className="ax-bar-rw">
        <div className="ax-dots" aria-hidden="true" />
        <div className="ax-bar-r">
          <button type="button" className="ax-brief" onClick={onBrief}><Play /> Today's briefing</button>
          <span className="ax-kbd" title="Open Archon from anywhere on Home">⌘J</span>
        </div>
      </div>
    </div>
  );
}
