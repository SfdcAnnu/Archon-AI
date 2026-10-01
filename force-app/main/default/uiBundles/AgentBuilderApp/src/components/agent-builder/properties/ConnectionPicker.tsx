import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Loader2, Plus, RefreshCw, UserRound, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { startMyConnectionFor } from '@/lib/chat-data';
import { startConnectorOAuth } from '@/lib/connector-admin-data';
import { cachedIdentityPolicy, loadUsableConnections, startPrincipalOAuth, GROUP_TYPE_LABEL, type ConnectionRow, type GroupKeyType, type UsableConnections } from '@/lib/identity-data';
import type { CatalogNodeConfig } from '@/types/agent';
import { IdentityFields } from './IdentityFields';

/**
 * Whose account a connector node uses — chosen where the connector is
 * used, on the canvas. Pick one of the accounts you can use (yours, your
 * team's, the org's), authorise a new one right here, or leave it to each
 * person to connect their own when they chat. A pinned account is stored
 * under the connector like any other, so admins see it on the Connectors
 * tab and other agents can pick it too.
 */
type Scope = 'me' | 'team' | 'org';

const fmtDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null);

function Row({ row, kind, selected, onPick }: { row: ConnectionRow; kind: 'mine' | 'team' | 'org'; selected: boolean; onPick: () => void }) {
  const tone = kind === 'mine' ? 'bg-[var(--archon-success-tint)] text-[var(--archon-success)]' : kind === 'team' ? 'bg-[var(--node-blue-tint)] text-[var(--node-blue)]' : 'bg-[var(--node-gray-tint)] text-[var(--node-gray)]';
  const sub = kind === 'team'
    ? `${row.subjectLabel ?? row.subjectKey ?? 'Team'}${row.subjectType ? ` · ${GROUP_TYPE_LABEL[row.subjectType as GroupKeyType] ?? row.subjectType}` : ''}`
    : kind === 'org' ? (row.id === 'setup' ? "The org's connection from Archon Setup" : "The org's shared account") : row.status === 'Connected' ? `Connected${fmtDay(row.lastConnectedAt) ? ` ${fmtDay(row.lastConnectedAt)}` : ''}` : row.status;
  const broken = row.status !== 'Connected';
  return (
    <label className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2', selected ? 'border-primary bg-accent' : 'border-border hover:bg-secondary')}>
      <input type="radio" name="catalog-connection" className="h-3.5 w-3.5" checked={selected} onChange={onPick} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11.5px] font-semibold text-foreground">{row.accountEmail ?? row.subjectLabel ?? row.providerKey}</span>
        <span className={cn('truncate text-[10px]', broken ? 'text-[var(--archon-error)]' : 'text-muted-foreground')}>{broken ? `${row.status} — reconnect it before using it` : sub}</span>
      </span>
      <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold', tone)}>{kind === 'mine' ? 'Mine' : kind === 'team' ? 'Team' : 'Org'}</span>
    </label>
  );
}

export function ConnectionPicker({ cfg, provider, providerName, onConfigChange }: {
  cfg: CatalogNodeConfig;
  provider: string;
  providerName: string;
  onConfigChange: (patch: Partial<CatalogNodeConfig>) => void;
}) {
  const [usable, setUsable] = useState<UsableConnections | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [orgDefault, setOrgDefault] = useState<'user' | 'group' | 'org'>('user');
  const [dialog, setDialog] = useState(false);
  const [scope, setScope] = useState<Scope>('me');
  const [groupKey, setGroupKey] = useState('');
  /** A sign-in window is open for this scope, while we wait for it. */
  const [busy, setBusy] = useState<Scope | null>(null);

  const load = useCallback(() => {
    setState('loading');
    return loadUsableConnections(provider)
      .then(u => { setUsable(u); setState('ready'); return u; })
      .catch(err => { console.error('Failed to load usable connections:', err); setState('error'); return null; });
  }, [provider]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    cachedIdentityPolicy().then(r => !cancelled && setOrgDefault(r.policy.defaultRunAs)).catch(() => { /* default stands */ });
    return () => { cancelled = true; };
  }, []);

  // What the node says today. Unset runAs follows the org default; a
  // legacy 'org' node is drawn as the org row.
  const effective = cfg.runAs ?? orgDefault;
  const pinnedId = effective === 'connection' ? (cfg.connectorId || null) : effective === 'org' ? (usable?.org?.id ?? null) : null;
  const eachUser = effective === 'user' || effective === 'group';
  const rows = useMemo(() => {
    if (!usable) return [] as Array<{ row: ConnectionRow; kind: 'mine' | 'team' | 'org' }>;
    const list: Array<{ row: ConnectionRow; kind: 'mine' | 'team' | 'org' }> = [];
    for (const r of usable.mine) list.push({ row: r, kind: 'mine' });
    for (const r of usable.team) list.push({ row: r, kind: 'team' });
    if (usable.org) list.push({ row: usable.org, kind: 'org' });
    return list;
  }, [usable]);
  const pinnedRow = rows.find(r => r.row.id === pinnedId)?.row ?? null;

  const pin = useCallback((row: ConnectionRow) => {
    // Salesforce's org connection is the Setup token, not a stored row:
    // the node runs "as the org" and the runtime uses it directly.
    if (row.id === 'setup') { onConfigChange({ runAs: 'org', connectorId: '', required: undefined, fallback: undefined }); return; }
    onConfigChange({ runAs: 'connection', connectorId: row.id, required: undefined, fallback: undefined });
  }, [onConfigChange]);
  const chooseEachUser = useCallback(() => {
    onConfigChange({ runAs: 'user', connectorId: usable?.org?.id ?? '' });
  }, [onConfigChange, usable]);

  /** Opens the provider's sign-in for the chosen scope and, once the new
   *  row says Connected, pins it on the node. */
  const connectNew = useCallback(() => {
    const group = usable?.groups.find(g => g.key === groupKey) ?? null;
    if (scope === 'team' && !group) { toast.error('Pick a group first.'); return; }
    const known = new Set(rows.map(r => r.row.id));
    const popup = window.open('about:blank', `archon_oauth_${provider}_${scope}`, 'width=620,height=720,scrollbars=yes');
    const startedAt = Date.now();
    setBusy(scope);
    const returnUrl = window.location.href;
    const start: Promise<{ authorizeUrl: string }> =
      scope === 'me' ? startMyConnectionFor(returnUrl, provider, `${providerName} (my account)`)
      : scope === 'team' ? startPrincipalOAuth({ providerKey: provider, displayName: `${providerName} — ${group!.label}`, returnUrl, principalType: 'group', subjectType: group!.type, subjectKey: group!.key, subjectLabel: group!.label })
      : startConnectorOAuth(provider, providerName, returnUrl);
    start
      .then(({ authorizeUrl }) => {
        if (popup) popup.location.href = authorizeUrl;
        else window.open(authorizeUrl, `archon_oauth_${provider}_${scope}`, 'width=620,height=720,scrollbars=yes');
        setDialog(false);
        toast.info(`Sign in to ${providerName} in the window that opened`, { description: 'The account is stored under the connector and selected here once you allow access.' });
        const until = Date.now() + 180_000;
        const poll = () => {
          loadUsableConnections(provider)
            .then(u => {
              const all = [...u.mine, ...u.team, ...(u.org ? [u.org] : [])];
              const fresh = all.find(r => r.status === 'Connected' && (!known.has(r.id) || (r.lastConnectedAt && Date.parse(r.lastConnectedAt) >= startedAt - 60_000)));
              if (fresh) {
                setUsable(u); setState('ready'); setBusy(null);
                pin(fresh);
                toast.success(`${fresh.accountEmail ?? providerName} connected and selected.`, { description: 'Stored under the connector — pick it again on any other agent.' });
                return;
              }
              if (Date.now() < until) setTimeout(poll, 3000);
              else { setBusy(null); toast.info('Not connected yet', { description: 'If you finished signing in, press refresh on the connection list.' }); }
            })
            .catch(() => { if (Date.now() < until) setTimeout(poll, 4000); else setBusy(null); });
        };
        setTimeout(poll, 4000);
      })
      .catch(err => {
        popup?.close();
        setBusy(null);
        toast.error(`Could not start the ${providerName} sign-in`, { description: err instanceof Error ? err.message : undefined });
      });
  }, [scope, groupKey, usable, rows, provider, providerName, pin]);

  return (
    <div className="space-y-3 rounded-lg border border-primary/60 p-3">
      <div className="flex items-center gap-1.5">
        <UserRound className="h-3.5 w-3.5 text-[var(--node-blue)]" />
        <Label className="text-[11px] font-bold">Connection</Label>
        <span className="text-[10px] text-muted-foreground">— whose {providerName} this agent uses</span>
        <button type="button" onClick={load} className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground" title="Refresh" aria-label="Refresh connections"><RefreshCw className="h-3 w-3" /></button>
      </div>

      {state === 'loading' && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Looking up your accounts…</div>}
      {state === 'error' && <div className="text-[11px] text-muted-foreground">Couldn't list your accounts — the server may be waking up. <button type="button" className="font-semibold text-primary hover:underline" onClick={load}>Retry</button></div>}

      {state === 'ready' && (
        <div className="space-y-1.5">
          {rows.map(({ row, kind }) => <Row key={row.id} row={row} kind={kind} selected={pinnedId === row.id} onPick={() => pin(row)} />)}
          {rows.length === 0 && <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-[10.5px] text-muted-foreground">No {providerName} account you can use yet — connect one below, or let each person connect their own.</p>}

          <label className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed px-2.5 py-2', eachUser ? 'border-[var(--node-purple)] bg-[var(--node-purple-tint)]' : 'border-border hover:bg-secondary')}>
            <input type="radio" name="catalog-connection" className="h-3.5 w-3.5" checked={eachUser} onChange={chooseEachUser} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[11.5px] font-semibold text-foreground">Each user's own account</span>
              <span className="text-[10px] text-muted-foreground">They connect their {providerName} the first time they chat</span>
            </span>
            <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold', eachUser ? 'bg-[var(--node-purple)] text-white' : 'bg-[var(--node-purple-tint)] text-[var(--node-purple)]')}>Per user</span>
          </label>

          <Button variant="outline" size="sm" className="h-8 w-full text-[11.5px] font-bold text-primary" disabled={busy != null} onClick={() => { setScope('me'); setGroupKey(usable?.groups[0]?.key ?? ''); setDialog(true); }}>
            {busy ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Waiting for sign-in…</> : <><Plus className="mr-1 h-3 w-3" /> Connect a new account…</>}
          </Button>
        </div>
      )}

      {state === 'ready' && (pinnedRow ? (
        <div className="flex items-start gap-2 rounded-md bg-secondary px-2.5 py-2 text-[10.5px] leading-snug text-foreground">
          <Users className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
          <span>Everyone who uses this agent acts as <b>{pinnedRow.accountEmail ?? pinnedRow.subjectLabel}</b>{pinnedRow.principalType === 'user' ? ' — a personal account; other builders cannot pick it, but every user of this agent spends it' : ''}.</span>
        </div>
      ) : eachUser ? (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-md bg-[var(--node-purple-tint)] px-2.5 py-2 text-[10.5px] leading-snug text-foreground">
            <UserRound className="mt-0.5 h-3 w-3 shrink-0 text-[var(--node-purple)]" />
            <span>Each person reads and acts from <b>their own</b> {providerName}. Nobody sees anyone else's account; a run that cannot act as its person fails with the reason.</span>
          </div>
          <IdentityFields cfg={cfg} onConfigChange={onConfigChange} />
        </div>
      ) : effective === 'org' && !usable?.org ? (
        <div className="flex items-start gap-2 rounded-md bg-[var(--archon-warning-tint)] px-2.5 py-2 text-[10.5px] leading-snug text-[var(--archon-warning)]">
          <Building2 className="mt-0.5 h-3 w-3 shrink-0" />
          <span>This node runs as the org's shared account, but none is connected for {providerName}. Connect one, or pick another option.</span>
        </div>
      ) : null)}

      <Dialog open={dialog} onOpenChange={v => !v && setDialog(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Connect a new {providerName} account</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">Sign in once; the account is stored under {providerName} and can be picked again on any other agent.</p>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[11px] font-bold">Who will use it?</legend>
              {(([
                ['me', 'Just me', 'Private to me. Only I can pick it on my agents; everyone who uses those agents acts as it.'],
                ['team', 'My team', 'One shared account for a group. Anyone in the group can pick it.'],
                ['org', 'Whole org', 'The one shared account on the Connectors tab. Any builder can pick it.'],
              ]) as Array<[Scope, string, string]>).map(([k, title, sub]) => (
                <label key={k} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5', scope === k ? 'border-primary bg-accent' : 'border-border hover:bg-secondary')}>
                  <input type="radio" name="connect-scope" className="mt-0.5 h-3.5 w-3.5" checked={scope === k} onChange={() => setScope(k)} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[12.5px] font-semibold text-foreground">{title}</span>
                    <span className="text-[11px] text-muted-foreground">{sub}</span>
                    {k === 'team' && scope === 'team' && (
                      usable && usable.groups.length > 0 ? (
                        <Select value={groupKey} onValueChange={setGroupKey}>
                          <SelectTrigger className="mt-1 h-8 w-full text-xs"><SelectValue placeholder="Pick a group" /></SelectTrigger>
                          <SelectContent>
                            {usable.groups.map(g => <SelectItem key={`${g.type}:${g.key}`} value={g.key}>{g.label} · {GROUP_TYPE_LABEL[g.type]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-[11px] text-[var(--archon-warning)]">You don't belong to any group yet — ask an admin, or choose another scope.</span>
                      )
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Cancel</Button>
            <Button disabled={busy != null || (scope === 'team' && !groupKey)} onClick={connectNew}>
              {busy ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Waiting for sign-in…</> : `Sign in to ${providerName}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
