import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'destructive' paints the confirm button red — deletes and resets. */
  variant?: 'default' | 'destructive';
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

// Module-level bridge so any code (event handlers, catch blocks) can raise a
// confirm without threading React context around — same pattern sonner's
// toast() uses. Set by the single <ConfirmHost /> mounted in App.tsx.
let enqueue: ((p: Pending) => void) | null = null;

/** Styled, promise-based replacement for window.confirm():
 *    if (!(await confirmDialog({ title: 'Delete "X"?', variant: 'destructive' }))) return;
 *  Resolves true on confirm, false on cancel/escape/outside-click. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    if (!enqueue) {
      // Host not mounted (shouldn't happen) — degrade to the native dialog
      // rather than silently confirming a destructive action.
      resolve(window.confirm(options.title));
      return;
    }
    enqueue({ ...options, resolve });
  });
}

/** Mounted once at the app root; renders whatever confirmDialog() raised. */
export function ConfirmHost() {
  const [current, setCurrent] = useState<Pending | null>(null);

  useEffect(() => {
    enqueue = p =>
      setCurrent(prev => {
        prev?.resolve(false); // a second confirm supersedes an unanswered first
        return p;
      });
    return () => {
      enqueue = null;
    };
  }, []);

  const close = (ok: boolean) => {
    current?.resolve(ok);
    setCurrent(null);
  };

  return (
    <Dialog open={current != null} onOpenChange={v => !v && close(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            {current?.variant === 'destructive' && (
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            )}
            {current?.title}
          </DialogTitle>
          {current?.description && (
            <DialogDescription className="text-[12px]">{current.description}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => close(false)}>
            {current?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={current?.variant === 'destructive' ? 'destructive' : 'default'}
            size="sm"
            className="h-8 text-xs"
            onClick={() => close(true)}
            autoFocus
          >
            {current?.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
