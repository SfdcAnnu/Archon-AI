import { useState } from 'react';
import { Check, Loader2, ShieldAlert, ShieldCheck, ShieldX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { decideChatApproval, type ChatApproval } from '@/lib/chat-approvals-data';

/** Human-readable form of a runtime tool slug (do_update_the_deal_a1b2c3,
 *  apex__SendQuote, …) — the raw name stays visible underneath. */
function prettyToolName(name: string): string {
  const cleaned = name
    .replace(/^(do_|find_|apex__|flow__)/, '')
    .replace(/_[a-z0-9]{4,8}$/, '')
    .replace(/_+/g, ' ')
    .trim();
  return cleaned || name;
}

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  Pending: { label: 'Needs approval', bg: 'var(--node-amber-tint, #FDF3E1)', fg: 'var(--node-amber, #B7791F)' },
  Approved: { label: 'Approved — running', bg: 'var(--archon-success-tint, #E7F6EE)', fg: 'var(--archon-success, #1F9D61)' },
  Executed: { label: 'Approved & done', bg: 'var(--archon-success-tint, #E7F6EE)', fg: 'var(--archon-success, #1F9D61)' },
  Rejected: { label: 'Rejected', bg: 'var(--node-gray-tint, #EEF0F3)', fg: 'var(--node-gray, #64748B)' },
  Failed: { label: 'Approved, but failed', bg: 'var(--node-gray-tint, #EEF0F3)', fg: 'var(--destructive, #DC2626)' },
  Expired: { label: 'Expired', bg: 'var(--node-gray-tint, #EEF0F3)', fg: 'var(--node-gray, #64748B)' },
};

export interface ChatApprovalCardProps {
  approval: ChatApproval;
  /** Fired with the updated row after a decision lands. */
  onChanged: (updated: ChatApproval) => void;
}

/** One suspended agent action, rendered inline in a conversation: what the
 *  agent wants to run, with which values, and Approve/Reject. Approve
 *  executes the stored call on the server immediately, so the button stays
 *  busy until the real result comes back. */
export function ChatApprovalCard({ approval, onChanged }: ChatApprovalCardProps) {
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meta = STATUS_META[approval.status] ?? STATUS_META.Pending;
  const args =
    approval.argsJson && typeof approval.argsJson === 'object' && !Array.isArray(approval.argsJson)
      ? (approval.argsJson as Record<string, unknown>)
      : null;

  const decide = (decision: 'approved' | 'rejected') => {
    setBusy(decision);
    setError(null);
    decideChatApproval(approval.id, decision)
      .then(r =>
        onChanged({
          ...approval,
          status: r.status,
          resultText: r.resultText ?? r.error ?? approval.resultText,
        })
      )
      .catch(e => setError(e instanceof Error ? e.message : 'The decision could not be saved.'))
      .finally(() => setBusy(null));
  };

  const Icon = approval.status === 'Executed' ? ShieldCheck : approval.status === 'Rejected' ? ShieldX : ShieldAlert;

  return (
    <div className="overflow-hidden rounded-lg border border-border" style={{ borderLeft: `3px solid ${meta.fg}` }}>
      <div className="flex items-start gap-2.5 px-3 pt-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: meta.fg }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-bold capitalize text-foreground">{prettyToolName(approval.toolName)}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
              style={{ backgroundColor: meta.bg, color: meta.fg }}
            >
              {meta.label}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{approval.toolName}</div>
        </div>
      </div>

      {args && Object.keys(args).length > 0 && (
        <div className="mx-3 mt-2 overflow-hidden rounded-md border border-border/70 bg-muted/30">
          {Object.entries(args).map(([k, v]) => (
            <div key={k} className="flex items-start gap-2 border-t border-border/50 px-2.5 py-1.5 text-[11px] first:border-t-0">
              <span className="w-28 shrink-0 font-medium text-muted-foreground">{k}</span>
              <span className="min-w-0 flex-1 break-words text-foreground">
                {typeof v === 'string' ? v : JSON.stringify(v)}
              </span>
            </div>
          ))}
        </div>
      )}

      {approval.resultText && approval.status !== 'Pending' && (
        <pre className="mx-3 mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-2.5 py-1.5 text-[10.5px] text-muted-foreground">
          {approval.resultText}
        </pre>
      )}

      {error && <p className="mx-3 mt-2 text-[11px] text-destructive">{error}</p>}

      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="text-[10px] text-muted-foreground">
          {approval.status === 'Pending'
            ? `Requested ${new Date(approval.createdAt).toLocaleString()} · expires ${new Date(approval.timeoutAt).toLocaleString()}`
            : `Requested ${new Date(approval.createdAt).toLocaleString()}`}
        </span>
        {approval.status === 'Pending' && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-[11px]"
              disabled={busy !== null}
              onClick={() => decide('rejected')}
            >
              {busy === 'rejected' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <X className="mr-1 h-3 w-3" />}
              Reject
            </Button>
            <Button size="sm" className="h-7 px-2.5 text-[11px]" disabled={busy !== null} onClick={() => decide('approved')}>
              {busy === 'approved' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
              {busy === 'approved' ? 'Running…' : 'Approve & run'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
