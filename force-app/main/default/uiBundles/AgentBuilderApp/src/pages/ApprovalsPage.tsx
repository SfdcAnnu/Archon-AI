import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckSquare, Loader2, MessageSquare, X } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AttnRow,
  EmptyPanel,
  IconSquare,
  SpecCard,
  StatusBadge,
  type BadgeTone,
} from '@/components/spec/blocks';
import { loadPendingApprovals, decideApproval, type ApprovalDto } from '@/lib/approvals-data';
import { listChatApprovals, type ChatApproval } from '@/lib/chat-approvals-data';
import { ChatApprovalCard } from '@/components/chat/ChatApprovalCard';

/** Human-readable form of a runtime tool slug — same rule ChatApprovalCard
 *  uses internally (it does not export it). */
function prettyToolName(name: string): string {
  const cleaned = name
    .replace(/^(do_|find_|apex__|flow__)/, '')
    .replace(/_[a-z0-9]{4,8}$/, '')
    .replace(/_+/g, ' ')
    .trim();
  return cleaned || name;
}

function waitingFor(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'a while';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}

const CHAT_OUTCOME: Record<string, { label: string; tone: BadgeTone }> = {
  Approved: { label: 'Approved', tone: 'ok' },
  Executed: { label: 'Approved & done', tone: 'ok' },
  Rejected: { label: 'Rejected', tone: 'muted' },
  Failed: { label: 'Approved, but failed', tone: 'error' },
  Expired: { label: 'Expired', tone: 'muted' },
};

type PendingItem =
  | { kind: 'automation'; key: string; createdAt: string; a: ApprovalDto }
  | { kind: 'chat'; key: string; createdAt: string; c: ChatApproval };

interface DecidedItem {
  key: string;
  title: string;
  sub: string;
  outcome: string;
  tone: BadgeTone;
}

/** The big spec card for an automation approval: what is being approved,
 *  shown plainly, with the optional comment and the decision buttons. */
function AutomationHero({
  approval,
  onDecided,
}: {
  approval: ApprovalDto;
  onDecided: (a: ApprovalDto, outcome: 'Approved' | 'Rejected') => void;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: 'approved' | 'rejected') => {
    setBusy(decision);
    setError(null);
    decideApproval(approval.id, decision, comment)
      .then(() => onDecided(approval, decision === 'approved' ? 'Approved' : 'Rejected'))
      .catch(err => {
        console.error('Failed to decide approval:', err);
        setError(err instanceof Error ? err.message : 'The decision could not be saved.');
        setBusy(null);
      });
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5">
        <IconSquare bg="var(--archon-warning-tint)" color="var(--node-amber)">
          <CheckSquare className="h-4 w-4" />
        </IconSquare>
        <b className="text-[13px] text-foreground">{approval.nodeLabel}</b>
        <div className="ml-auto">
          <StatusBadge tone="warn">Waiting {waitingFor(approval.createdDate)}</StatusBadge>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-7 gap-y-2 px-3.5 pt-3 text-[11px] text-[var(--archon-faint)]">
        <span>
          Asked by
          <br />
          <b className="text-[12px] text-foreground">{approval.agentApiName}</b>
        </span>
        {approval.recordId && (
          <span>
            Record
            <br />
            <b className="font-mono text-[12px] text-foreground">{approval.recordId}</b>
          </span>
        )}
        <span>
          Requested
          <br />
          <b className="text-[12px] text-foreground">{new Date(approval.createdDate).toLocaleString()}</b>
        </span>
        {approval.timeoutAt && (
          <span>
            Times out
            <br />
            <b className="text-[12px] text-foreground">{new Date(approval.timeoutAt).toLocaleString()}</b>
          </span>
        )}
      </div>

      <div className="px-3.5 pt-3">
        <Textarea
          rows={2}
          className="text-[12px]"
          placeholder="Comment (optional) — recorded with your decision"
          value={comment}
          onChange={e => setComment(e.target.value)}
        />
      </div>
      {error && <p className="px-3.5 pt-2 text-[11.5px] text-destructive">{error}</p>}

      <div className="flex gap-2 px-3.5 py-3.5">
        <Button size="sm" className="h-8 text-[11.5px]" disabled={busy != null} onClick={() => decide('approved')}>
          {busy === 'approved' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
          Approve
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[11.5px] text-[var(--archon-error)]"
          disabled={busy != null}
          onClick={() => decide('rejected')}
        >
          {busy === 'rejected' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <X className="mr-1 h-3 w-3" />}
          Reject
        </Button>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  const [autoApprovals, setAutoApprovals] = useState<ApprovalDto[]>([]);
  const [chatApprovals, setChatApprovals] = useState<ChatApproval[]>([]);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready'>('loading');
  const [heroId, setHeroId] = useState<string | null>(null);
  const [decided, setDecided] = useState<DecidedItem[]>([]);

  const load = useCallback(() => {
    setLoadState('loading');
    Promise.allSettled([loadPendingApprovals(), listChatApprovals({ status: 'Pending' })]).then(([auto, chat]) => {
      if (auto.status === 'fulfilled') {
        setAutoApprovals(auto.value);
        setAutoError(null);
      } else {
        console.error('Failed to load approvals:', auto.reason);
        setAutoApprovals([]);
        setAutoError('Automation approvals could not be loaded.');
      }
      if (chat.status === 'fulfilled') {
        setChatApprovals(chat.value);
        setChatError(null);
      } else {
        console.error('Failed to load chat approvals:', chat.reason);
        setChatApprovals([]);
        setChatError('Chat approvals could not be loaded.');
      }
      setLoadState('ready');
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Both kinds merged, oldest first — the oldest pending item is the hero
  // unless a Review click promoted another one.
  const pending: PendingItem[] = useMemo(() => {
    const items: PendingItem[] = [
      ...autoApprovals.map(a => ({ kind: 'automation' as const, key: `auto-${a.id}`, createdAt: a.createdDate, a })),
      ...chatApprovals
        .filter(c => c.status === 'Pending')
        .map(c => ({ kind: 'chat' as const, key: `chat-${c.id}`, createdAt: c.createdAt, c })),
    ];
    return items.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  }, [autoApprovals, chatApprovals]);

  const hero = pending.find(p => p.key === heroId) ?? pending[0] ?? null;
  const rest = pending.filter(p => p !== hero);

  const handleAutoDecided = useCallback((a: ApprovalDto, outcome: 'Approved' | 'Rejected') => {
    setAutoApprovals(list => list.filter(x => x.id !== a.id));
    setDecided(d => [
      {
        key: `auto-${a.id}`,
        title: a.nodeLabel,
        sub: a.agentApiName,
        outcome,
        tone: outcome === 'Approved' ? 'ok' : 'muted',
      },
      ...d,
    ]);
    setHeroId(null);
  }, []);

  const handleChatChanged = useCallback((updated: ChatApproval) => {
    setChatApprovals(list => {
      if (updated.status === 'Pending') return list.map(x => (x.id === updated.id ? updated : x));
      return list.filter(x => x.id !== updated.id);
    });
    if (updated.status !== 'Pending') {
      const meta = CHAT_OUTCOME[updated.status] ?? { label: updated.status, tone: 'muted' as BadgeTone };
      setDecided(d => [
        {
          key: `chat-${updated.id}`,
          title: prettyToolName(updated.toolName),
          sub: updated.agentApiName,
          outcome: meta.label,
          tone: meta.tone,
        },
        ...d,
      ]);
      setHeroId(null);
    }
  }, []);

  return (
    <AppShell title="Approvals" onRefresh={load}>
      <div className="mx-auto w-full max-w-4xl p-5">
        {loadState === 'loading' && (
          <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}

        {loadState === 'ready' && (
          <div className="grid gap-3.5">
            {autoError && <p className="text-[11.5px] text-muted-foreground">{autoError}</p>}
            {chatError && <p className="text-[11.5px] text-muted-foreground">{chatError}</p>}

            {pending.length === 0 && <EmptyPanel>Nothing is waiting for you.</EmptyPanel>}

            {hero &&
              (hero.kind === 'automation' ? (
                <AutomationHero key={hero.key} approval={hero.a} onDecided={handleAutoDecided} />
              ) : (
                <div className="overflow-hidden rounded-lg bg-card">
                  <ChatApprovalCard key={hero.key} approval={hero.c} onChanged={handleChatChanged} />
                </div>
              ))}

            {rest.length > 0 && (
              <SpecCard title="Also waiting" right={<StatusBadge tone="muted">{rest.length}</StatusBadge>}>
                {rest.map(item => (
                  <AttnRow
                    key={item.key}
                    icon={
                      item.kind === 'automation' ? (
                        <IconSquare bg="var(--archon-warning-tint)" color="var(--node-amber)">
                          <CheckSquare className="h-4 w-4" />
                        </IconSquare>
                      ) : (
                        <IconSquare bg="var(--node-blue-tint)" color="var(--node-blue)">
                          <MessageSquare className="h-4 w-4" />
                        </IconSquare>
                      )
                    }
                    title={item.kind === 'automation' ? item.a.nodeLabel : prettyToolName(item.c.toolName)}
                    sub={`${item.kind === 'automation' ? item.a.agentApiName : item.c.agentApiName} · waiting ${waitingFor(item.createdAt)}`}
                    onClick={() => setHeroId(item.key)}
                  >
                    <StatusBadge tone="muted">{item.kind === 'automation' ? 'Automation' : 'Chat tool'}</StatusBadge>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={e => {
                        e.stopPropagation();
                        setHeroId(item.key);
                      }}
                    >
                      Review
                    </Button>
                  </AttnRow>
                ))}
              </SpecCard>
            )}

            {decided.length > 0 && (
              <SpecCard title="Decided recently" muted="this page view only">
                {decided.map(d => (
                  <AttnRow
                    key={d.key}
                    icon={
                      <IconSquare bg="var(--node-gray-tint)" color="var(--node-gray)">
                        <Check className="h-4 w-4" />
                      </IconSquare>
                    }
                    title={d.title}
                    sub={d.sub}
                  >
                    <StatusBadge tone={d.tone}>{d.outcome}</StatusBadge>
                  </AttnRow>
                ))}
              </SpecCard>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
