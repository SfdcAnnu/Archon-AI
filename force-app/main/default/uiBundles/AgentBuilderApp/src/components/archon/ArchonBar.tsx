import { Activity, CheckCircle2, Globe, Mic, Play } from 'lucide-react';
import type { WakeWordState } from '@/hooks/useWakeWord';

/**
 * The Archon bar at the foot of Home. Left: the org, today's numbers and
 * the voice-wake switch. Centre: Talk to Archon. Right: today's briefing.
 * Tapping, typing or "Hey Archon" all lead to the same place — the
 * full-screen conversation — so the bar carries no composer of its own.
 */
export interface ArchonBarProps {
  today: { runs: number; failed: number } | null;
  pending: number;
  loading: boolean;
  wake: WakeWordState;
  onTalk: () => void;
  onBrief: () => void;
}

const Wave = () => (
  <span className="ax-jw" aria-hidden="true">
    <i /><i /><i /><i /><i /><i /><i />
  </span>
);

export function ArchonBar({ today, pending, loading, wake, onTalk, onBrief }: ArchonBarProps) {
  const voiceLine = !wake.supported
    ? 'Not in this browser'
    : wake.error ?? (wake.listening ? (wake.heard ? `“${wake.heard}”` : 'Listening') : 'Off');
  return (
    <div className={`ax-bar${wake.listening ? ' voice' : ''}`} data-waiting={pending > 0 ? '1' : '0'} role="region" aria-label="Archon">
      <div className="ax-bar-tiles">
        <div className="ax-bt"><Globe /><span><small>Org</small><b>Production</b></span></div>
        <div className="ax-bt"><Activity /><span><small>Today</small><b>{loading || !today ? '…' : `${today.runs} handled · ${today.failed} failed`}</b></span></div>
        <div className="ax-bt"><CheckCircle2 /><span><small>Waiting on you</small><b>{loading ? '…' : pending ? `${pending} approval${pending === 1 ? '' : 's'}` : 'nothing'}</b></span></div>
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
      <button type="button" className="ax-talk" onClick={onTalk}>
        <Wave />
        <span className="tt"><b>Talk to Archon</b><small>{wake.listening ? 'Listening for “Hey Archon”…' : 'Say “Hey Archon” or tap'}</small></span>
        <Wave />
      </button>
      <div className="ax-dots" aria-hidden="true" />
      <div className="ax-bar-r">
        <button type="button" className="ax-brief" onClick={onBrief}><Play /> Today's briefing</button>
        <span className="ax-kbd" title="Open Archon from anywhere on Home">⌘J</span>
      </div>
    </div>
  );
}
