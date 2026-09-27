import { X } from 'lucide-react';

export function CanvasLegend({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute right-3 top-14 z-10 min-w-[168px] rounded-[var(--radius)] border border-border bg-card px-3.5 py-2.5 text-[10.5px] text-muted-foreground shadow-[0_1px_2px_rgba(16,18,30,.07),0_4px_10px_rgba(16,18,30,.05)]">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">Legend</span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="h-0 w-5 border-t-[1.6px] border-muted-foreground" />
        Structural flow
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="h-0 w-5 border-t-[1.6px] border-dashed border-primary opacity-70" />
        Tool / catalog attachment
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="h-0 w-5 border-t-[2.2px] border-dashed border-primary" />
        Subagent handoff
      </div>
    </div>
  );
}
