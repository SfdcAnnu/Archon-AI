import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { searchUsers, type UserOption } from '@/lib/identity-data';
import { loadHandoffGroups, loadHandoffQueues, type HandoffGroup, type HandoffQueue } from '@/lib/handoff-data';
import type { HandoffWho, ToolNodeConfig } from '@/types/agent';

/**
 * The "Hand off to a person" node. Everything about the handoff is here:
 * who takes over, how they are told, when the agent takes the
 * conversation back, and what the customer hears both ways. The server's
 * hand_off_to_human tool reads this config; Apex does the notifying and
 * the routing from the status change it writes.
 */
const WHO: Array<{ value: HandoffWho; label: string; sub: string }> = [
  { value: 'owner', label: 'Record owner', sub: 'the Lead or Case owner; the conversation owner when there is no record' },
  { value: 'queue', label: 'A queue', sub: 'its members are told; whoever opens it first replies' },
  { value: 'user', label: 'A named user', sub: 'always the same person' },
  { value: 'group', label: 'A group', sub: 'a public group; its members are told' },
  { value: 'omni', label: 'Omni-Channel queue', sub: 'Salesforce routes it to the next available person' },
];

export function HandoffForm({ cfg, onConfigChange }: { cfg: ToolNodeConfig; onConfigChange: (patch: Partial<ToolNodeConfig>) => void }) {
  const who: HandoffWho = cfg.whoTakesOver ?? 'owner';
  const [queues, setQueues] = useState<HandoffQueue[] | null>(null);
  const [groups, setGroups] = useState<HandoffGroup[] | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if ((who === 'queue' || who === 'omni') && queues === null) {
      loadHandoffQueues().then(setQueues).catch(() => setQueues([]));
    }
    if (who === 'group' && groups === null) {
      loadHandoffGroups().then(setGroups).catch(() => setGroups([]));
    }
  }, [who, queues, groups]);

  useEffect(() => {
    if (who !== 'user' || userQuery.trim().length < 2) { setUsers([]); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchUsers(userQuery.trim())
        .then(list => { if (alive) setUsers(list); })
        .catch(() => { if (alive) setUsers([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [who, userQuery]);

  const pickWho = (value: HandoffWho) => {
    if (value === who) return;
    onConfigChange({ whoTakesOver: value, assigneeId: '', assigneeLabel: '' });
  };
  const pick = (id: string, label: string) => onConfigChange({ assigneeId: id, assigneeLabel: label });

  const queueList = (queues ?? []).filter(q => (who === 'omni' ? q.omni : true));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Description (shown to the AI)</Label>
        <Textarea
          value={cfg.description ?? ''}
          onChange={e => onConfigChange({ description: e.target.value })}
          placeholder="When the agent should hand the conversation to a person."
          className="min-h-20 text-xs"
        />
        <p className="text-[10px] leading-snug text-muted-foreground">
          The agent calls this once, says the line below to the customer, and goes silent until the conversation returns.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Who takes over</Label>
        <div className="space-y-1">
          {WHO.map(w => (
            <label
              key={w.value}
              className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2', who === w.value ? 'border-primary bg-accent' : 'border-border hover:bg-secondary')}
            >
              <input type="radio" name="handoff-who" className="mt-0.5 h-3.5 w-3.5" checked={who === w.value} onChange={() => pickWho(w.value)} />
              <span className="flex min-w-0 flex-col">
                <span className="text-[11.5px] font-semibold text-foreground">{w.label}</span>
                <span className="text-[10px] text-muted-foreground">{w.sub}</span>
              </span>
            </label>
          ))}
        </div>

        {(who === 'queue' || who === 'omni') && (
          <div className="ml-6 space-y-1.5">
            {queues === null ? (
              <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading queues…</p>
            ) : queueList.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-[10.5px] text-muted-foreground">
                {who === 'omni' ? 'No queue has an Omni-Channel routing configuration yet. Set one up in Setup → Omni-Channel, then pick it here.' : 'No queues in this org yet.'}
              </p>
            ) : (
              <select
                className="h-8 w-full rounded-md border border-input bg-card px-2 text-[11.5px]"
                value={cfg.assigneeId ?? ''}
                onChange={e => { const q = queueList.find(x => x.id === e.target.value); if (q) pick(q.id, q.name); }}
              >
                <option value="">Pick a queue…</option>
                {queueList.map(q => <option key={q.id} value={q.id}>{q.name}{q.omni && who !== 'omni' ? ' · Omni-Channel' : ''}</option>)}
              </select>
            )}
            {who === 'omni' && (
              <>
                <label className="flex items-center gap-2 text-[11px]">
                  <input type="checkbox" className="h-3.5 w-3.5" checked={cfg.routeRelated ?? false} onChange={e => onConfigChange({ routeRelated: e.target.checked })} />
                  Route the related Lead or Case instead of the conversation
                </label>
                <p className="rounded-md bg-secondary px-2.5 py-2 text-[10.5px] leading-snug text-foreground">
                  On handoff the conversation's owner becomes this queue; Omni-Channel routes it to the next available person by your routing configuration. Needs a Service Channel for Archon conversations (shipped) and a routing configuration on the queue (yours).
                </p>
              </>
            )}
          </div>
        )}

        {who === 'group' && (
          <div className="ml-6">
            {groups === null ? (
              <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading groups…</p>
            ) : (
              <select
                className="h-8 w-full rounded-md border border-input bg-card px-2 text-[11.5px]"
                value={cfg.assigneeId ?? ''}
                onChange={e => { const g = groups.find(x => x.id === e.target.value); if (g) pick(g.id, g.name); }}
              >
                <option value="">Pick a public group…</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </div>
        )}

        {who === 'user' && (
          <div className="ml-6 space-y-1.5">
            {cfg.assigneeId ? (
              <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-[11.5px]">
                <span className="font-semibold text-foreground">{cfg.assigneeLabel || cfg.assigneeId}</span>
                <button type="button" className="text-[11px] text-primary" onClick={() => onConfigChange({ assigneeId: '', assigneeLabel: '' })}>change</button>
              </div>
            ) : (
              <>
                <Input value={userQuery} onChange={e => setUserQuery(e.target.value)} placeholder="Search people by name…" className="h-8 text-[11.5px]" />
                {searching && <p className="text-[10.5px] text-muted-foreground">Searching…</p>}
                {users.length > 0 && (
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {users.map(u => (
                      <button key={u.userId} type="button" className="flex w-full items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-left text-[11.5px] hover:bg-secondary" onClick={() => pick(u.userId, u.name)}>
                        <span className="font-semibold text-foreground">{u.name}</span>
                        <span className="text-[10px] text-muted-foreground">{u.email ?? ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {who !== 'omni' && (
        <div className="space-y-1.5">
          <Label className="text-[11px] font-bold">How they are told</Label>
          <div className="flex gap-2">
            <label className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]', cfg.notifyNotification !== false ? 'border-primary bg-accent' : 'border-border')}>
              <input type="checkbox" className="h-3 w-3" checked={cfg.notifyNotification !== false} onChange={e => onConfigChange({ notifyNotification: e.target.checked })} /> Notification
            </label>
            <label className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]', cfg.notifyEmail !== false ? 'border-primary bg-accent' : 'border-border')}>
              <input type="checkbox" className="h-3 w-3" checked={cfg.notifyEmail !== false} onChange={e => onConfigChange({ notifyEmail: e.target.checked })} /> Email
            </label>
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">The same notification and email the connection reminders use, with the customer's last message and a link to the conversation.</p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Return to the agent after</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={168}
            value={cfg.returnAfterHours ?? 12}
            onChange={e => onConfigChange({ returnAfterHours: Math.max(1, Math.min(168, Number(e.target.value) || 12)) })}
            className="h-8 w-20 text-[11.5px]"
          />
          <span className="text-[11.5px] text-muted-foreground">hours of quiet</span>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">If nobody writes in the conversation for this long, the agent takes it back. "Return to agent" on the conversation does it at once.</p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">What the customer hears</Label>
        <Textarea
          value={cfg.customerLineOnHandoff ?? ''}
          onChange={e => onConfigChange({ customerLineOnHandoff: e.target.value })}
          placeholder="A colleague will take it from here and reply on this number."
          className="min-h-14 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">What the customer hears when it returns</Label>
        <Textarea
          value={cfg.customerLineOnReturn ?? ''}
          onChange={e => onConfigChange({ customerLineOnReturn: e.target.value })}
          placeholder="Leave blank for a silent return."
          className="min-h-14 text-xs"
        />
      </div>
    </div>
  );
}
