import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Bell, Building2, Loader2, Plug, Plus, RefreshCw, Server, UserPlus, Users, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { EmptyPanel, IconSquare, NoteBar, SpecCard, StatusBadge, T, type BadgeTone } from '@/components/spec/blocks';
import type { DirectoryEntry } from '@/lib/connectors-data';
import { disconnectConnector } from '@/lib/connector-admin-data';
import {
  AUTH_STYLES,
  GROUP_TYPE_LABEL,
  deleteServerOverride,
  loadConnectorDetail,
  loadGroups,
  loadRoster,
  saveServerOverride,
  searchUsers,
  sendConnectionReminders,
  startPrincipalOAuth,
  testServer,
  type ConnectorDetail as Detail,
  type GroupKeyType,
  type GroupOption,
  type Roster as RosterData,
  type RosterStatus,
  type ServerOverride,
  type ServerTestResult,
  type UserOption,
} from '@/lib/identity-data';

/**
 * One connector, opened from the directory: who holds a connection to it
 * (the org, each group, each person), the MCP server behind it, and its
 * tools. Every number is the server's or Salesforce's — never guessed.
 */

type Tab = 'connections' | 'server' | 'tools';

const fmtWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');

function statusTone(status: string): BadgeTone {
  if (status === 'Connected') return 'ok';
  if (status === 'Error') return 'error';
  if (status === 'Pending') return 'warn';
  return 'muted';
}

/** Opens the provider's sign-in for a principal and waits for its row to
 *  say Connected (three minutes at most). The popup is opened before the
 *  request so a blocker does not eat it. */
function useSignIn(entry: DirectoryEntry, reload: () => Promise<Detail>, onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const start = useCallback((input: { principalType: 'org' | 'group'; subjectType?: string | null; subjectKey?: string | null; subjectLabel?: string | null; displayName: string }) => {
    const key = input.subjectKey ?? 'org';
    const popup = window.open('about:blank', `archon_oauth_${entry.providerKey}_${key}`, 'width=620,height=720,scrollbars=yes');
    const startedAt = Date.now();
    setBusy(key);
    startPrincipalOAuth({ providerKey: entry.providerKey, displayName: input.displayName, returnUrl: window.location.href, principalType: input.principalType, subjectType: input.subjectType ?? null, subjectKey: input.subjectKey ?? null, subjectLabel: input.subjectLabel ?? null })
      .then(({ authorizeUrl }) => {
        if (popup) popup.location.href = authorizeUrl;
        else window.open(authorizeUrl, `archon_oauth_${entry.providerKey}_${key}`, 'width=620,height=720,scrollbars=yes');
        toast.info(`Sign in as ${input.displayName} in the window that opened`, { description: 'This page updates by itself once access is allowed.' });
        const until = Date.now() + 180_000;
        const poll = () => {
          reload()
            .then(d => {
              const row = input.principalType === 'org' ? d.org : d.groups.find(g => g.subjectKey === input.subjectKey) ?? null;
              const at = row?.lastConnectedAt ? Date.parse(row.lastConnectedAt) : 0;
              if (row && row.status === 'Connected' && at >= startedAt - 60_000) {
                setBusy(null);
                toast.success(`${input.displayName} connected${row.accountEmail ? ` as ${row.accountEmail}` : ''}.`);
                onChanged();
                return;
              }
              if (Date.now() < until) setTimeout(poll, 3000);
              else { setBusy(null); toast.info(`${input.displayName} is not connected yet`, { description: 'If you finished signing in, press Refresh.' }); }
            })
            .catch(() => { if (Date.now() < until) setTimeout(poll, 4000); else setBusy(null); });
        };
        setTimeout(poll, 4000);
      })
      .catch(err => {
        popup?.close();
        setBusy(null);
        toast.error(`Could not start the ${input.displayName} sign-in`, { description: err instanceof Error ? err.message : undefined });
      });
  }, [entry.providerKey, reload, onChanged]);
  return { busy, start };
}

// ── the roster: who must connect, who did ──────────────────────────

type RosterFilter = 'all' | 'must' | 'missing' | 'expired';

const ROSTER_TONE: Record<RosterStatus, BadgeTone> = { connected: 'ok', pending: 'warn', error: 'error', expired: 'warn', notConnected: 'muted', viaGroup: 'blue' };
const ROSTER_LABEL: Record<RosterStatus, string> = { connected: 'Connected', pending: 'Pending', error: 'Error', expired: 'Expired', notConnected: 'Not connected', viaGroup: 'Via group' };

/** Add a person to the roster by hand: invite them to connect, or — with
 *  them beside you — sign in as them right now. */
function AddUserDialog({ open, displayName, busy, onClose, onInvite, onSignIn }: {
  open: boolean;
  displayName: string;
  busy: string | null;
  onClose: () => void;
  onInvite: (users: UserOption[]) => void;
  onSignIn: (user: UserOption) => void;
}) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<UserOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, UserOption>>(new Map());

  useEffect(() => { if (open) { setQ(''); setPicked(new Map()); setUsers(null); setError(null); } }, [open]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(() => {
      searchUsers(q).then(list => !cancelled && setUsers(list)).catch(err => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, q]);

  const toggle = (u: UserOption) => setPicked(m => { const n = new Map(m); if (n.has(u.userId)) n.delete(u.userId); else n.set(u.userId, u); return n; });
  const one = picked.size === 1 ? [...picked.values()][0] : null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add a user connection for {displayName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">
            A person's own {displayName} account. Invite them and they sign in from My connections or the chat that needs it; or, with them beside you, sign in as them now.
          </p>
          <div className="space-y-1.5">
            <Label>Find people</Label>
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Name or email" className="h-8 text-xs" autoFocus />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-md border border-border">
            {users === null && !error && <div className="flex items-center gap-2 px-3 py-3 text-[11.5px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Listing from Salesforce…</div>}
            {error && <div className="px-3 py-3 text-[11.5px] text-destructive">{error}</div>}
            {users !== null && users.length === 0 && <div className="px-3 py-3 text-[11.5px] text-muted-foreground">No active user matches.</div>}
            {(users ?? []).map(u => (
              <label key={u.userId} className={cn('flex w-full cursor-pointer items-center gap-2.5 border-b border-border px-3 py-1.5 text-left text-[12px] last:border-b-0 hover:bg-secondary', picked.has(u.userId) && 'bg-accent')}>
                <input type="checkbox" className="h-3.5 w-3.5" checked={picked.has(u.userId)} onChange={() => toggle(u)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-foreground">{u.name}</span>
                  <span className="block truncate text-[10.5px] text-[var(--archon-faint)]">{u.email ?? ''}{u.department ? ` · ${u.department}` : ''}</span>
                </span>
              </label>
            ))}
          </div>
          {picked.size > 0 && <p className="text-[11px] text-muted-foreground">{picked.size} {picked.size === 1 ? 'person' : 'people'} selected{one ? ` — ${one.name}` : ''}.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="outline" disabled={picked.size === 0 || busy != null} onClick={() => onInvite([...picked.values()])}>
            <Bell className="mr-1 h-3 w-3" /> Invite {picked.size > 1 ? `${picked.size} people` : 'to connect'}
          </Button>
          <Button disabled={!one || busy != null} title={picked.size > 1 ? 'Sign in one person at a time' : undefined} onClick={() => one && onSignIn(one)}>
            {busy && one && busy === one.userId ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Waiting for sign-in…</> : `Sign in as ${one ? one.name.split(' ')[0] : 'this person'} now`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Everyone who has used an agent that runs as the person on this
 *  provider, plus anyone an admin added, with their standing, a reminder
 *  button, and a way to add a person by hand. */
export function Roster({ providerKey, displayName, compact }: { providerKey: string; displayName?: string; compact?: boolean }) {
  const [roster, setRoster] = useState<RosterData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [adding, setAdding] = useState(false);
  /** The person whose sign-in window is open, while we wait for it. */
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const name = displayName ?? providerKey;

  const load = useCallback(() => {
    setState('loading');
    return loadRoster(providerKey)
      .then(r => { setRoster(r); setState('ready'); setPicked(new Set()); return r; })
      .catch(err => { console.error('Failed to load roster:', err); setState('error'); return null; });
  }, [providerKey]);
  useEffect(() => { load(); }, [load]);

  /** Opens the provider's sign-in for ONE person's own account and waits
   *  for their roster row to say connected (three minutes at most). */
  const signInAs = useCallback((u: UserOption) => {
    const popup = window.open('about:blank', `archon_oauth_${providerKey}_${u.userId}`, 'width=620,height=720,scrollbars=yes');
    const startedAt = Date.now();
    setSigningIn(u.userId);
    startPrincipalOAuth({ providerKey, displayName: `${name} — ${u.name}`, returnUrl: window.location.href, principalType: 'user', subjectType: 'user', subjectKey: u.userId, subjectLabel: u.name })
      .then(({ authorizeUrl }) => {
        if (popup) popup.location.href = authorizeUrl;
        else window.open(authorizeUrl, `archon_oauth_${providerKey}_${u.userId}`, 'width=620,height=720,scrollbars=yes');
        setAdding(false);
        toast.info(`${u.name} signs in to ${name} in the window that opened`, { description: 'Their own account, on their own row — this page updates by itself once access is allowed.' });
        const until = Date.now() + 180_000;
        const poll = () => {
          loadRoster(providerKey)
            .then(r => {
              const row = r.users.find(x => x.userId === u.userId);
              const at = row?.lastConnectedAt ? Date.parse(row.lastConnectedAt) : 0;
              if (row && row.status === 'connected' && at >= startedAt - 60_000) {
                setRoster(r); setSigningIn(null);
                toast.success(`${u.name} connected ${name}${row.accountEmail ? ` as ${row.accountEmail}` : ''}.`);
                return;
              }
              if (Date.now() < until) setTimeout(poll, 3000);
              else { setSigningIn(null); toast.info(`${u.name} is not connected yet`, { description: 'If they finished signing in, press Refresh.' }); }
            })
            .catch(() => { if (Date.now() < until) setTimeout(poll, 4000); else setSigningIn(null); });
        };
        setTimeout(poll, 4000);
      })
      .catch(err => {
        popup?.close();
        setSigningIn(null);
        toast.error(`Could not start the ${name} sign-in`, { description: err instanceof Error ? err.message : undefined });
      });
  }, [providerKey, name]);

  const rows = useMemo(() => {
    const all = roster?.users ?? [];
    const list = filter === 'must' ? all.filter(u => u.neededBy.length > 0)
      : filter === 'missing' ? all.filter(u => u.neededBy.length > 0 && u.status !== 'connected' && u.status !== 'viaGroup')
      : filter === 'expired' ? all.filter(u => u.status === 'expired')
      : all;
    return [...list].sort((a, b) => Number(b.neededBy.length > 0) - Number(a.neededBy.length > 0) || (a.name ?? '').localeCompare(b.name ?? ''));
  }, [roster, filter]);

  const remind = useCallback((ids: string[], verb = 'Reminded') => {
    if (!ids.length) return;
    setSending(true);
    sendConnectionReminders(providerKey, ids)
      .then(n => { toast.success(`${verb} ${n} ${n === 1 ? 'person' : 'people'}.`, { description: 'An email and a Salesforce notification, linking to My connections.' }); setAdding(false); load(); })
      .catch(err => toast.error(`Could not send ${verb === 'Invited' ? 'invites' : 'reminders'}`, { description: err instanceof Error ? err.message : undefined }))
      .finally(() => setSending(false));
  }, [providerKey, load]);

  const missingIds = useMemo(() => (roster?.users ?? []).filter(u => u.neededBy.length > 0 && u.status !== 'connected' && u.status !== 'viaGroup').map(u => u.userId), [roster]);

  return (
    <SpecCard
      title={compact ? 'People' : 'People who connect their own account'}
      muted={roster ? `${roster.mustConnect} must connect · ${roster.connected} connected · ${roster.notConnected} not yet · ${roster.expired} expired` : ''}
      right={
        <div className="flex items-center gap-1.5">
          {(([['all', 'All'], ['must', 'Must connect'], ['missing', 'Not connected'], ['expired', 'Expired']]) as Array<[RosterFilter, string]>).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className={cn('rounded-full border px-2.5 py-[3px] text-[10.5px] font-semibold transition-colors', filter === k ? 'border-primary bg-primary text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground')}>{label}</button>
          ))}
          <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={sending || missingIds.length === 0} onClick={() => remind(picked.size ? [...picked] : missingIds)}>
            {sending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Bell className="mr-1 h-3 w-3" />}
            {picked.size ? `Remind ${picked.size}` : `Remind all not connected${missingIds.length ? ` (${missingIds.length})` : ''}`}
          </Button>
          <Button size="sm" className="h-7 text-[11px]" onClick={() => setAdding(true)}>
            <UserPlus className="mr-1 h-3 w-3" /> Add user connection
          </Button>
          <button type="button" onClick={load} className="rounded p-1 text-muted-foreground hover:text-foreground" title="Refresh" aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
      }
    >
      <AddUserDialog open={adding} displayName={name} busy={signingIn} onClose={() => setAdding(false)} onInvite={users => remind(users.map(u => u.userId), 'Invited')} onSignIn={signInAs} />
      {state === 'loading' && <div className="flex items-center gap-2 px-3.5 py-5 text-[12.5px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading who has used these agents…</div>}
      {state === 'error' && <div className="px-3.5 py-5 text-[12.5px] text-destructive">Couldn't load the roster. <button type="button" className="font-semibold underline" onClick={load}>Retry</button></div>}
      {state === 'ready' && roster && (
        <>
          {roster.serverUnreachable && <NoteBar tone="warn">The Archon server did not answer, so connection statuses may be stale. Refresh in a moment.</NoteBar>}
          {roster.agentsNeeding.length > 0 && (
            <div className="border-b border-border px-3.5 py-2 text-[11px] text-muted-foreground">
              Runs as the person in: {roster.agentsNeeding.map(a => <span key={a} className="ml-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10.5px] font-semibold text-foreground">{a}</span>)}
            </div>
          )}
          {rows.length === 0 ? (
            <div className="px-3.5 py-5 text-[12px] text-muted-foreground">
              {roster.users.length === 0 ? 'Nobody has used an agent that runs as the person on this connector yet, and nobody has connected their own account. Add a user connection to invite someone, or sign in as them.' : 'No one matches this filter.'}
            </div>
          ) : (
            <table className={T.table}>
              <thead>
                <tr>
                  <th className={cn(T.th, 'w-8')}><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && rows.every(r => picked.has(r.userId))} onChange={e => setPicked(e.target.checked ? new Set(rows.map(r => r.userId)) : new Set())} /></th>
                  <th className={T.th}>Person</th>
                  <th className={T.th}>Status</th>
                  <th className={T.th}>Account</th>
                  <th className={T.th}>Needed by</th>
                  <th className={T.th}>Reminded</th>
                  <th className={cn(T.th, 'text-right')}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(u => {
                  const missing = u.neededBy.length > 0 && u.status !== 'connected' && u.status !== 'viaGroup';
                  return (
                    <tr key={u.userId}>
                      <td className={T.td}><input type="checkbox" aria-label={`Select ${u.name ?? u.userId}`} checked={picked.has(u.userId)} onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(u.userId); else n.delete(u.userId); return n; })} /></td>
                      <td className={T.td}>
                        <div className="text-[12px] font-semibold text-foreground">{u.name ?? u.userId}</div>
                        <div className="text-[10.5px] text-[var(--archon-faint)]">{u.email ?? ''}</div>
                      </td>
                      <td className={T.td}>
                        <StatusBadge tone={u.status === 'notConnected' && u.remindedCount > 0 ? 'blue' : ROSTER_TONE[u.status]}>
                          {u.status === 'notConnected' && u.remindedCount > 0 ? 'Invited' : ROSTER_LABEL[u.status]}
                        </StatusBadge>
                        {u.lastErrorMessage && <div className="mt-0.5 max-w-[220px] truncate text-[10px] text-[var(--archon-error)]" title={u.lastErrorMessage}>{u.lastErrorMessage}</div>}
                      </td>
                      <td className={cn(T.td, 'text-[11.5px] text-muted-foreground')}>{u.accountEmail ?? '—'}{u.lastConnectedAt && <div className="text-[10px] text-[var(--archon-faint)]">{fmtWhen(u.lastConnectedAt)}</div>}</td>
                      <td className={T.td}>{u.neededBy.length ? <div className="flex flex-wrap gap-1">{u.neededBy.map(a => <span key={a} className="rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-foreground">{a}</span>)}</div> : <span className="text-[11px] text-[var(--archon-faint)]">—</span>}</td>
                      <td className={cn(T.td, 'text-[11px] text-muted-foreground')}>{u.remindedCount ? `${u.remindedCount}× · ${u.remindedAt ? new Date(u.remindedAt).toLocaleDateString() : ''}` : '—'}</td>
                      <td className={cn(T.td, 'text-right')}>
                        {(missing || (u.status !== 'connected' && u.status !== 'viaGroup')) && (
                          <div className="flex justify-end gap-1.5">
                            <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={sending} onClick={() => remind([u.userId])}>Remind</Button>
                            <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={signingIn != null} onClick={() => signInAs({ userId: u.userId, name: u.name ?? u.userId, email: u.email, department: null, title: null })}>
                              {signingIn === u.userId ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Sign in as them'}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <NoteBar>People connect from the chat that needs it, or from My connections. A reminder is an email and a Salesforce notification with that link; the count and date above are the server's record of them.</NoteBar>
        </>
      )}
    </SpecCard>
  );
}

// ── add a group connection ─────────────────────────────────────────

function AddGroupDialog({ open, entry, defaultType, busy, onClose, onConnect }: {
  open: boolean;
  entry: DirectoryEntry;
  defaultType: GroupKeyType;
  busy: string | null;
  onClose: () => void;
  onConnect: (input: { subjectType: GroupKeyType; subjectKey: string; subjectLabel: string; displayName: string }) => void;
}) {
  const [type, setType] = useState<GroupKeyType>(defaultType);
  const [groups, setGroups] = useState<GroupOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<GroupOption | null>(null);
  const [displayName, setDisplayName] = useState('');

  useEffect(() => { if (open) { setType(defaultType); setPicked(null); setQ(''); setDisplayName(''); } }, [open, defaultType]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setGroups(null); setError(null);
    loadGroups(type).then(g => !cancelled && setGroups(g)).catch(err => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => { cancelled = true; };
  }, [open, type]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (groups ?? []).filter(g => !s || g.label.toLowerCase().includes(s)).slice(0, 60);
  }, [groups, q]);

  const name = displayName.trim() || (picked ? `${entry.displayName} — ${picked.label}` : '');

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add a group connection for {entry.displayName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">One shared {entry.displayName} account for a team. Everyone in the group uses it when an agent runs as their group; nobody outside can.</p>
          <div className="grid grid-cols-[150px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>Group type</Label>
              <Select value={type} onValueChange={v => { setType(v as GroupKeyType); setPicked(null); }}>
                <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(GROUP_TYPE_LABEL) as GroupKeyType[]).map(k => <SelectItem key={k} value={k}>{GROUP_TYPE_LABEL[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Find the group</Label>
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${GROUP_TYPE_LABEL[type].toLowerCase()}s`} className="h-8 text-xs" />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto rounded-md border border-border">
            {groups === null && !error && <div className="flex items-center gap-2 px-3 py-3 text-[11.5px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Listing from Salesforce…</div>}
            {error && <div className="px-3 py-3 text-[11.5px] text-destructive">{error}</div>}
            {groups !== null && shown.length === 0 && <div className="px-3 py-3 text-[11.5px] text-muted-foreground">No {GROUP_TYPE_LABEL[type].toLowerCase()} matches.</div>}
            {shown.map(g => (
              <button key={g.key} type="button" onClick={() => setPicked(g)} className={cn('flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-[12px] last:border-b-0 hover:bg-secondary', picked?.key === g.key && 'bg-accent font-semibold')}>
                <span className="min-w-0 flex-1 truncate">{g.label}</span>
                {g.members != null && <span className="font-mono text-[10px] text-[var(--archon-faint)]">{g.members} {g.members === 1 ? 'member' : 'members'}</span>}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label>Connection name</Label>
            <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder={picked ? `${entry.displayName} — ${picked.label}` : 'Pick a group first'} className="h-8 text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!picked || busy != null} onClick={() => picked && onConnect({ subjectType: type, subjectKey: picked.key, subjectLabel: picked.label, displayName: name })}>
            {busy ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Waiting for sign-in…</> : `Sign in as the ${picked?.label ?? 'group'} account`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── change the MCP server behind a connector ───────────────────────

function ChangeServerDialog({ open, entry, override, onClose, onSaved }: {
  open: boolean;
  entry: DirectoryEntry;
  override: ServerOverride | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState('');
  const [authStyle, setAuthStyle] = useState('provider-token');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ServerTestResult | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl(override?.mcpServerUrl ?? entry.mcpServerUrl ?? '');
    setAuthStyle(override?.authStyle ?? 'provider-token');
    setApiKey('');
    setResult(null);
  }, [open, override, entry.mcpServerUrl]);

  const valid = /^https?:\/\/\S+$/.test(url.trim());
  const runTest = () => {
    setTesting(true); setResult(null);
    testServer({ providerKey: entry.providerKey, mcpServerUrl: url.trim(), authStyle, apiKey: apiKey || null })
      .then(setResult)
      .catch(err => setResult({ ok: false, message: err instanceof Error ? err.message : String(err) }))
      .finally(() => setTesting(false));
  };
  const save = () => {
    setSaving(true);
    saveServerOverride({ providerKey: entry.providerKey, mcpServerUrl: url.trim(), authStyle, ...(authStyle === 'api-key' && apiKey ? { apiKey } : {}) })
      .then(() => { toast.success(`${entry.displayName} now uses ${url.trim()}.`); onSaved(); onClose(); })
      .catch(err => toast.error('Could not save the server', { description: err instanceof Error ? err.message : undefined }))
      .finally(() => setSaving(false));
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Change the server behind {entry.displayName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">
            Point this connector at a different MCP server — the provider's own hosted one, a copy you run, or a proxy. Connections and tokens stay as they are; only where the tools are called from changes.
          </p>
          <div className="space-y-1.5">
            <Label>MCP server URL</Label>
            <Input value={url} onChange={e => { setUrl(e.target.value); setResult(null); }} placeholder="https://…/mcp" className="h-8 font-mono text-xs" />
            {entry.mcpServerUrl && <p className="text-[10.5px] text-muted-foreground">Catalog default: <span className="font-mono">{entry.mcpServerUrl}</span></p>}
          </div>
          <div className="space-y-1.5">
            <Label>How Archon authenticates to it</Label>
            <Select value={authStyle} onValueChange={v => { setAuthStyle(v); setResult(null); }}>
              <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{AUTH_STYLES.map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {authStyle === 'api-key' && (
            <div className="space-y-1.5">
              <Label>API key</Label>
              <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={override?.hasApiKey ? 'Leave empty to keep the saved key' : 'Stored sealed on the server'} className="h-8 text-xs" />
            </div>
          )}
          {result && (
            <div className={cn('rounded-md border px-3 py-2 text-[11.5px]', result.ok ? 'border-[var(--archon-success)] bg-[var(--archon-success-tint)] text-[var(--archon-success)]' : 'border-[var(--archon-error)] bg-[var(--archon-error-tint)] text-[var(--archon-error)]')}>
              {result.ok
                ? <>Answered in {result.ms} ms with {result.count} tool{result.count === 1 ? '' : 's'}{result.tools?.length ? <span className="block truncate font-mono text-[10.5px] opacity-80">{result.tools.slice(0, 8).join(', ')}{(result.tools.length > 8) ? '…' : ''}</span> : null}</>
                : <>{result.message ?? result.error ?? 'The server did not answer.'}</>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="outline" onClick={runTest} disabled={!valid || testing || saving}>{testing ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Testing…</> : 'Test connection'}</Button>
          <Button onClick={save} disabled={!valid || saving}>{saving ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Saving…</> : 'Use this server'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── the page ───────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-3.5 py-[7px] text-[11.5px] last:border-b-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-right text-foreground">{children}</span>
    </div>
  );
}

export function ConnectorDetail({ entry, onBack, onChanged, onViewTools }: {
  entry: DirectoryEntry;
  onBack: () => void;
  onChanged: () => void;
  onViewTools: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tab, setTab] = useState<Tab>('connections');
  const [addGroup, setAddGroup] = useState(false);
  const [changeServer, setChangeServer] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const reload = useCallback(() => loadConnectorDetail(entry.providerKey).then(d => { setDetail(d); setState('ready'); return d; }), [entry.providerKey]);
  useEffect(() => {
    setState('loading');
    reload().catch(err => { console.error('Failed to load connector detail:', err); setState('error'); });
  }, [reload]);

  const { busy, start } = useSignIn(entry, reload, onChanged);
  const isSalesforce = entry.providerKey === 'salesforce_mcp';

  const disconnectRow = useCallback(async (id: string, what: string) => {
    if (!(await confirmDialog({ title: `Disconnect ${what}?`, description: 'Agents that run as this principal will ask for it again.', confirmLabel: 'Disconnect', variant: 'destructive' }))) return;
    setBusyRow(id);
    disconnectConnector(id)
      .then(() => { toast.success(`${what} disconnected.`); reload().catch(() => {}); onChanged(); })
      .catch(err => toast.error('Disconnect failed', { description: err instanceof Error ? err.message : undefined }))
      .finally(() => setBusyRow(null));
  }, [reload, onChanged]);

  const clearOverride = useCallback(async () => {
    if (!(await confirmDialog({ title: 'Use the catalog default server?', confirmLabel: 'Use default' }))) return;
    deleteServerOverride(entry.providerKey)
      .then(() => { toast.success(`${entry.displayName} uses its default server again.`); reload().catch(() => {}); })
      .catch(err => toast.error('Could not remove the override', { description: err instanceof Error ? err.message : undefined }));
  }, [entry.providerKey, entry.displayName, reload]);

  const TABS: Array<[Tab, string, typeof Users]> = [['connections', 'Connections', Users], ['server', 'Server', Server], ['tools', 'Tools', Wrench]];

  return (
    <>
      <div className="mb-3.5 flex items-center gap-3">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Directory</button>
        <IconSquare bg={entry.brandColor ?? 'var(--node-gray)'}><Plug className="h-4 w-4" /></IconSquare>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-bold text-foreground">{entry.displayName}</span>
            {detail && (
              <>
                {detail.org?.status === 'Connected' && <StatusBadge tone="ok">Org connected</StatusBadge>}
                {detail.groups.length > 0 && <StatusBadge tone="blue">{detail.groups.length} group{detail.groups.length === 1 ? '' : 's'}</StatusBadge>}
                {detail.users.total > 0 && <StatusBadge tone={detail.users.expired ? 'warn' : 'muted'}>{detail.users.connected} of {detail.users.total} people{detail.users.expired ? ` · ${detail.users.expired} expired` : ''}</StatusBadge>}
              </>
            )}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{entry.description ?? entry.category ?? 'MCP connector'}</div>
        </div>
        <div className="inline-flex gap-0.5 rounded-md bg-secondary p-0.5">
          {TABS.map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={cn('flex items-center gap-1 rounded-[5px] px-3 py-[5px] text-[11.5px] font-semibold transition-colors', tab === key ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground')}><Icon className="h-3 w-3" />{label}</button>
          ))}
        </div>
      </div>

      {state === 'loading' && <div className="flex items-center gap-2 py-6 text-[12.5px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>}
      {state === 'error' && <EmptyPanel>Couldn't load this connector — the server may be waking up. Use Refresh to try again.</EmptyPanel>}

      {state === 'ready' && detail && tab === 'connections' && (
        <div className="space-y-3.5">
          {detail.salesforce && (
            <NoteBar tone={detail.salesforce.jwtEnabled ? undefined : 'warn'}>
              {detail.salesforce.jwtEnabled
                ? 'Automatic sign-in is on: a Salesforce token is minted for whoever is chatting, so nobody connects by hand.'
                : detail.salesforce.jwtConfigured
                  ? 'Automatic sign-in (JWT) is available on the server but off — turn it on in Settings → Identity & access, and people stop connecting Salesforce by hand.'
                  : 'Automatic sign-in (JWT) is not set up on the server, so people connect their own Salesforce once from the chat that needs it.'}
            </NoteBar>
          )}

          <SpecCard title="Org connection" muted="one account everyone may share" right={
            <div className="flex items-center gap-1.5">
              {!isSalesforce && <Button size="sm" className="h-7 text-[11px]" disabled={busy != null || !entry.mcpServerUrl} onClick={() => start({ principalType: 'org', displayName: entry.displayName })}>{busy === 'org' ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Waiting for sign-in…</> : detail.org?.status === 'Connected' ? 'Reconnect' : 'Connect the org account'}</Button>}
              {!isSalesforce && detail.org && detail.org.status === 'Connected' && <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={busyRow === detail.org.id} onClick={() => disconnectRow(detail.org!.id, `the org's ${entry.displayName}`)}>Disconnect</Button>}
            </div>
          }>
            {isSalesforce ? (
              <div className="px-3.5 py-3 text-[12px] text-muted-foreground">The org's Salesforce connection is the one Archon Setup made. Manage it on the Setup page.</div>
            ) : detail.org ? (
              <>
                <Row label="Status"><StatusBadge tone={statusTone(detail.org.status)}>{detail.org.status}</StatusBadge></Row>
                <Row label="Account">{detail.org.accountEmail ?? '—'}</Row>
                <Row label="Connected by">{detail.org.configuredBy ?? '—'}</Row>
                <Row label="Last connected">{fmtWhen(detail.org.lastConnectedAt)}</Row>
                {detail.org.lastErrorMessage && <Row label="Last error"><span className="text-[var(--archon-error)]">{detail.org.lastErrorMessage}</span></Row>}
              </>
            ) : (
              <div className="px-3.5 py-3 text-[12px] text-muted-foreground">No org connection. Agents whose connector runs as the org, or falls back to it, cannot use {entry.displayName} until one is connected.</div>
            )}
          </SpecCard>

          <SpecCard title="Group connections" muted="one shared account per team" right={
            <Button size="sm" className="h-7 text-[11px]" disabled={!entry.mcpServerUrl} onClick={() => setAddGroup(true)}><Plus className="mr-1 h-3 w-3" /> Add group</Button>
          }>
            {detail.groups.length === 0 ? (
              <div className="px-3.5 py-3 text-[12px] text-muted-foreground">No group connections. Bind one to a {GROUP_TYPE_LABEL[detail.policy.groupKeyType]} so a team shares one {entry.displayName} account.</div>
            ) : (
              <table className={T.table}>
                <thead><tr><th className={T.th}>Group</th><th className={T.th}>Status</th><th className={T.th}>Account</th><th className={T.th}>Last connected</th><th className={cn(T.th, 'text-right')}></th></tr></thead>
                <tbody>
                  {detail.groups.map(g => (
                    <tr key={g.id}>
                      <td className={T.td}>
                        <div className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-[var(--node-blue)]" /><span className="text-[12px] font-semibold text-foreground">{g.subjectLabel ?? g.subjectKey}</span></div>
                        <div className="text-[10.5px] text-[var(--archon-faint)]">{g.subjectType ? GROUP_TYPE_LABEL[g.subjectType as GroupKeyType] ?? g.subjectType : ''}</div>
                      </td>
                      <td className={T.td}><StatusBadge tone={statusTone(g.status)}>{g.status}</StatusBadge></td>
                      <td className={cn(T.td, 'text-[11.5px] text-muted-foreground')}>{g.accountEmail ?? '—'}</td>
                      <td className={cn(T.td, 'text-[11px] text-muted-foreground')}>{fmtWhen(g.lastConnectedAt)}</td>
                      <td className={cn(T.td, 'text-right')}>
                        <div className="flex justify-end gap-1.5">
                          <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={busy != null} onClick={() => start({ principalType: 'group', subjectType: g.subjectType, subjectKey: g.subjectKey, subjectLabel: g.subjectLabel, displayName: `${entry.displayName} — ${g.subjectLabel ?? g.subjectKey}` })}>{busy === g.subjectKey ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reconnect'}</Button>
                          <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={busyRow === g.id} onClick={() => disconnectRow(g.id, `${g.subjectLabel ?? 'this group'}'s ${entry.displayName}`)}>Disconnect</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SpecCard>

          <Roster providerKey={entry.providerKey} displayName={entry.displayName} />
        </div>
      )}

      {state === 'ready' && detail && tab === 'server' && (
        <SpecCard title="MCP server" muted="where this connector's tools are called" right={
          <div className="flex items-center gap-1.5">
            {detail.override && <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={clearOverride}>Use catalog default</Button>}
            <Button size="sm" className="h-7 text-[11px]" onClick={() => setChangeServer(true)}>Change server</Button>
          </div>
        }>
          <Row label="In use"><span className="font-mono">{detail.override?.mcpServerUrl ?? entry.mcpServerUrl ?? '— not deployed'}</span></Row>
          <Row label="Catalog default"><span className="font-mono">{entry.mcpServerUrl ?? '—'}</span></Row>
          <Row label="Authentication">{detail.override ? (AUTH_STYLES.find(([k]) => k === detail.override!.authStyle)?.[1] ?? detail.override.authStyle) : (entry.authType ? `${entry.authType} (catalog)` : "The connection's own token")}</Row>
          {detail.override && <Row label="Changed">{fmtWhen(detail.override.updatedAt)}{detail.override.updatedBy ? ` · ${detail.override.updatedBy}` : ''}</Row>}
          <NoteBar>
            A connector is a set of connections plus a server. The provider's hosted server (Google's, Microsoft's) and an Archon-hosted one speak the same protocol, so either can sit here; tokens are passed through as the authentication style says.
          </NoteBar>
        </SpecCard>
      )}

      {state === 'ready' && tab === 'tools' && (
        <SpecCard title="Tools" muted="listed live from the server in use">
          <div className="flex items-center justify-between gap-3 px-3.5 py-4">
            <p className="text-[12px] text-muted-foreground">Tools are enumerated from {detail?.override?.mcpServerUrl ?? entry.mcpServerUrl ?? 'the server'} each time the catalog is read, with the org's identity. Which agents may use each one is set on their Tool Catalog nodes.</p>
            <Button variant="outline" size="sm" className="h-7 shrink-0 text-[11px]" onClick={onViewTools}>View in All tools</Button>
          </div>
        </SpecCard>
      )}

      <AddGroupDialog open={addGroup} entry={entry} defaultType={detail?.policy.groupKeyType ?? 'permissionSet'} busy={busy} onClose={() => setAddGroup(false)} onConnect={input => { setAddGroup(false); start({ principalType: 'group', ...input }); }} />
      <ChangeServerDialog open={changeServer} entry={entry} override={detail?.override ?? null} onClose={() => setChangeServer(false)} onSaved={() => reload().catch(() => {})} />
    </>
  );
}
