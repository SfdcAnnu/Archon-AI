import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, MessageSquarePlus, RefreshCw, X } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { loadPendingApprovals, decideApproval, type ApprovalDto } from '@/lib/approvals-data';

function ApprovalCard({ approval, onDecided }: { approval: ApprovalDto; onDecided: (id: string) => void }) {
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = useCallback(
    (decision: 'approved' | 'rejected') => {
      setDeciding(decision);
      setError(null);
      decideApproval(approval.id, decision, comment)
        .then(() => onDecided(approval.id))
        .catch(err => {
          console.error('Failed to decide approval:', err);
          setError(err instanceof Error ? err.message : 'Failed to submit decision.');
          setDeciding(null);
        });
    },
    [approval.id, comment, onDecided]
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[13px] font-semibold text-foreground">{approval.nodeLabel}</div>
          <div className="text-[11.5px] text-muted-foreground">{approval.agentApiName}</div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        Requested {new Date(approval.createdDate).toLocaleString()}
        {approval.timeoutAt && ` · Times out ${new Date(approval.timeoutAt).toLocaleString()}`}
      </div>
      {approval.recordId && (
        <div className="mt-1 text-[11px] text-muted-foreground">Record: {approval.recordId}</div>
      )}

      {showComment && (
        <Textarea
          className="mt-3 text-[12px]"
          rows={2}
          placeholder="Add a comment (optional)"
          value={comment}
          onChange={e => setComment(e.target.value)}
        />
      )}
      {error && <p className="mt-2 text-[11.5px] text-destructive">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setShowComment(v => !v)} disabled={deciding != null}>
          <MessageSquarePlus className="mr-1 h-3 w-3" /> Add comment
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => decide('rejected')} disabled={deciding != null}>
            {deciding === 'rejected' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <X className="mr-1 h-3 w-3" />}
            Reject
          </Button>
          <Button size="sm" className="h-7 text-[11px]" onClick={() => decide('approved')} disabled={deciding != null}>
            {deciding === 'approved' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalDto[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(() => {
    setLoadState('loading');
    loadPendingApprovals()
      .then(rows => {
        setApprovals(rows);
        setLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to load approvals:', err);
        setLoadState('error');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDecided = useCallback((id: string) => {
    setApprovals(rows => rows.filter(r => r.id !== id));
  }, []);

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-5">
          <span className="text-[14px] font-bold text-foreground">Approvals</span>
          <button
            type="button"
            onClick={load}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </header>
        <div className="mx-auto w-full max-w-2xl flex-1 p-6">
          {loadState === 'loading' && (
            <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          {loadState === 'error' && (
            <p className="py-8 text-[12.5px] text-destructive">Couldn't load approvals.</p>
          )}
          {loadState === 'ready' && approvals.length === 0 && (
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <p className="text-[13px] text-muted-foreground">Nothing waiting on you right now.</p>
            </div>
          )}
          {loadState === 'ready' && approvals.length > 0 && (
            <div className="space-y-3">
              {approvals.map(a => (
                <ApprovalCard key={a.id} approval={a} onDecided={handleDecided} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
