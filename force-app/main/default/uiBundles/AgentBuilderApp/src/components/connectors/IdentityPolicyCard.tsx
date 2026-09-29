import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { KeyRound, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { loadIdentityPolicy, saveIdentityPolicy, GROUP_TYPE_LABEL, type IdentityPolicy, type PolicyResponse } from '@/lib/identity-data';

/** Settings → Identity & access: the org-wide default for whose account a
 *  connector runs as, which each connector node may override. */
export function IdentityPolicyCard() {
  const navigate = useNavigate();
  const [res, setRes] = useState<PolicyResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState<IdentityPolicy | null>(null);
  const [domains, setDomains] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadIdentityPolicy()
      .then(r => { if (cancelled) return; setRes(r); setDraft(r.policy); setDomains(r.policy.allowedDomains.join(', ')); setState('ready'); })
      .catch(err => { if (cancelled) return; console.error('Failed to load identity policy:', err); setState('error'); });
    return () => { cancelled = true; };
  }, []);

  const patch = useCallback((p: Partial<IdentityPolicy>) => setDraft(d => (d ? { ...d, ...p } : d)), []);

  const save = useCallback(() => {
    if (!draft) return;
    setSaving(true);
    saveIdentityPolicy({ ...draft, allowedDomains: domains.split(/[,\s]+/).map(s => s.trim().replace(/^@/, '')).filter(Boolean) })
      .then(r => { setRes(r); setDraft(r.policy); setDomains(r.policy.allowedDomains.join(', ')); toast.success('Identity policy saved.'); })
      .catch(err => toast.error('Save failed', { description: err instanceof Error ? err.message : undefined }))
      .finally(() => setSaving(false));
  }, [draft, domains]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[var(--node-blue)]" />
          <CardTitle>Identity &amp; access</CardTitle>
        </div>
        <CardDescription>
          Whose account a connector runs as by default — each person's own, a team's shared one, or the org's.
          Any connector node in an agent can override this on its Identity section.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {state === 'loading' && (
          <div className="flex items-center gap-2 py-4 text-[12.5px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
        )}
        {state === 'error' && <p className="text-[12.5px] text-destructive">Couldn't load the identity policy. Reload the page to try again.</p>}
        {state === 'ready' && draft && res && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Connectors run as</Label>
                <Select value={draft.defaultRunAs} onValueChange={v => patch({ defaultRunAs: v as IdentityPolicy['defaultRunAs'] })}>
                  <SelectTrigger className="h-9 w-full text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Each person — their own account</SelectItem>
                    <SelectItem value="group">A group — the team's shared account</SelectItem>
                    <SelectItem value="org">The org — one shared connection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>When the person has no connection</Label>
                <Select value={draft.defaultFallback} onValueChange={v => patch({ defaultFallback: v as IdentityPolicy['defaultFallback'] })}>
                  <SelectTrigger className="h-9 w-full text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Refuse — ask them to connect</SelectItem>
                    <SelectItem value="org">Use the org connection instead</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <div className="text-[13px] font-medium text-foreground">Never fall back to the org connection in chat</div>
                <div className="text-[11.5px] text-muted-foreground">A person chatting is always asked to connect their own account, whatever a node says. Automations may still use the org's.</div>
              </div>
              <Switch checked={draft.blockOrgFallbackForChat} onCheckedChange={v => patch({ blockOrgFallbackForChat: v })} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Groups are</Label>
                <Select value={draft.groupKeyType} onValueChange={v => patch({ groupKeyType: v as IdentityPolicy['groupKeyType'] })}>
                  <SelectTrigger className="h-9 w-full text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(GROUP_TYPE_LABEL) as Array<keyof typeof GROUP_TYPE_LABEL>).map(k => (
                      <SelectItem key={k} value={k}>{GROUP_TYPE_LABEL[k]}s</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10.5px] text-muted-foreground">A group connection is bound to one of these; membership is read live from Salesforce.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="identity-domains">Only accounts on these domains</Label>
                <Input id="identity-domains" value={domains} onChange={e => setDomains(e.target.value)} placeholder="acme.com, acme.co.uk — empty allows any" />
                <p className="text-[10.5px] text-muted-foreground">A personal Gmail signed in against a corporate agent is refused at connect time.</p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <div className="text-[13px] font-medium text-foreground">Automatic Salesforce sign-in (JWT bearer)</div>
                <div className="text-[11.5px] text-muted-foreground">
                  {res.sfJwt.configured
                    ? 'The server holds a connected-app certificate: people never connect Salesforce by hand — a token is minted for whoever is chatting.'
                    : 'Not set up on the server (SF_JWT_CLIENT_ID and SF_JWT_PRIVATE_KEY). Until then, people connect their own Salesforce once.'}
                </div>
              </div>
              <Switch checked={draft.sfJwtEnabled} disabled={!res.sfJwt.configured} onCheckedChange={v => patch({ sfJwtEnabled: v })} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="identity-remind-days">Remind every (days)</Label>
                <Input id="identity-remind-days" type="number" min={1} max={30} value={draft.reminderEveryDays} onChange={e => patch({ reminderEveryDays: Math.max(1, Number(e.target.value) || 1) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="identity-remind-max">At most (reminders)</Label>
                <Input id="identity-remind-max" type="number" min={1} max={20} value={draft.reminderMax} onChange={e => patch({ reminderMax: Math.max(1, Number(e.target.value) || 1) })} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button size="sm" className="h-8 text-xs" disabled={saving} onClick={save}>
                {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <button type="button" onClick={() => navigate('/connectors')} className="text-[11px] font-medium text-primary hover:underline">
                Manage connections per connector →
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
