/**
 * Archon's mark, as the Home dock always drew it: a disc that says ARCHON
 * inside two slowly turning arcs. Three sizes; the phase changes the arcs'
 * colour and pace, never the shape, so it reads the same in the header,
 * the bar and the faint glow behind the conversation.
 */
export type OrbPhase = 'ready' | 'listen' | 'think' | 'speak' | 'build';

export function ArchonOrb({ size = 'md', phase = 'ready', className = '' }: { size?: 'sm' | 'md' | 'xl'; phase?: OrbPhase; className?: string }) {
  return (
    <span className={`ax-orb ${size} ${className}`} data-phase={phase} aria-hidden="true">
      <svg viewBox="0 0 60 60">
        <circle className="tk" cx="30" cy="30" r="26" />
        <circle className="ar" cx="30" cy="30" r="29" />
        <circle className="ar b" cx="30" cy="30" r="22" />
      </svg>
      <span className="disc"><b>ARCHON</b></span>
    </span>
  );
}
