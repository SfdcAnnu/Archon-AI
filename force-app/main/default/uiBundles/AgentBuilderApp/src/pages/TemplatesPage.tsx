import { LayoutGrid } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardContent } from '@/components/ui/card';

/** Matches the old LWC's placeholder exactly (agentHome.html "Not built
 *  yet" section) — no backend exists for this yet, so this page is a
 *  faithful port of the stub, not a new feature. */
export default function TemplatesPage() {
  return (
    <AppShell>
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center border-b border-border bg-card px-5">
          <span className="text-[14px] font-bold text-foreground">Templates</span>
        </header>
        <div className="mx-auto w-full max-w-2xl flex-1 p-6">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <LayoutGrid className="h-6 w-6 text-muted-foreground" />
              <h4 className="text-[14.5px] font-semibold text-foreground">Not built yet</h4>
              <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-muted-foreground">
                No template library exists yet — every agent starts from scratch via "+ New Agent" today.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
