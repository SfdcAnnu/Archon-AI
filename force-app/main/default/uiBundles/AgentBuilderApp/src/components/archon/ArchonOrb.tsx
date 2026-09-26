/**
 * Archon's mark: a disc with the waveform glyph, in three sizes. The phase
 * changes its glow, not its shape, so it reads the same in the bar, the
 * page header and the full-screen greeting.
 */
export type OrbPhase = 'ready' | 'listen' | 'think' | 'speak' | 'build';

export function ArchonOrb({ size = 'md', phase = 'ready', className = '' }: { size?: 'sm' | 'md' | 'xl'; phase?: OrbPhase; className?: string }) {
  return (
    <span className={`ax-orb ${size} ${className}`} data-phase={phase} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h2" />
      </svg>
    </span>
  );
}
