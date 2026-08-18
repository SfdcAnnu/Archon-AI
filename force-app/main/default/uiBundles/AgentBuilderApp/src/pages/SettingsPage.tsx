import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { loadGuardrails, saveGuardrails, type GuardrailsStatus } from '@/lib/guardrails-data';
import { loadAccessStatus, type AccessStatus } from '@/lib/access-data';

function accessPillStyle(status: string) {
  const s = status.toLowerCase();
  if (s === 'connected') return { backgroundColor: 'var(--archon-success-tint)', color: 'var(--archon-success)' };
  if (s === 'error' || s === 'failed') return { backgroundColor: 'var(--archon-danger-tint, #fde8e8)', color: 'var(--archon-danger, #dc2626)' };
  return { backgroundColor: 'var(--node-gray-tint)', color: 'var(--node-gray)' };
}

function UsageBar({ used, cap, label }: { used: number; cap: number | null; label: string }) {
  const pct = cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const over = cap != null && used >= cap;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {used.toLocaleString()} {cap != null ? `/ ${cap.toLocaleString()}` : '(no cap set)'} tokens
        </span>
      </div>
      {cap != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              backgroundColor: over ? 'var(--archon-danger, #dc2626)' : 'var(--node-blue)',
            }}
          />
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<GuardrailsStatus | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');

  // Draft fields — separate from `status` so typing doesn't fight the
  // server-derived usage numbers, same pattern AgentBuilder.tsx uses for
  // its own local drafts vs. loaded graph state.
  const [isEnabled, setIsEnabled] = useState(false);
  const [maxPerDay, setMaxPerDay] = useState('');
  const [maxPerMonth, setMaxPerMonth] = useState('');

  const [access, setAccess] = useState<AccessStatus | null>(null);
  const [accessLoadState, setAccessLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    loadGuardrails()
      .then(s => {
        if (cancelled) return;
        setStatus(s);
        setIsEnabled(s.isEnabled);
        setMaxPerDay(s.maxTokensPerDay != null ? String(s.maxTokensPerDay) : '');
        setMaxPerMonth(s.maxTokensPerMonth != null ? String(s.maxTokensPerMonth) : '');
        setLoadState('ready');
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load guardrails:', err);
        setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Independent load — a failure here shouldn't block the guardrail card above.
  useEffect(() => {
    let cancelled = false;
    loadAccessStatus()
      .then(s => {
        if (cancelled) return;
        setAccess(s);
        setAccessLoadState('ready');
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load Salesforce access status:', err);
        setAccessLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = useCallback(() => {
    setSaveState('saving');
    saveGuardrails({
      isEnabled,
      maxTokensPerDay: maxPerDay.trim() === '' ? null : Number(maxPerDay),
      maxTokensPerMonth: maxPerMonth.trim() === '' ? null : Number(maxPerMonth),
    })
      .then(s => {
        setStatus(s);
        setSaveState('idle');
      })
      .catch(err => {
        console.error('Failed to save guardrails:', err);
        setSaveState('error');
      });
  }, [isEnabled, maxPerDay, maxPerMonth]);

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center border-b border-border bg-card px-5">
          <span className="text-[14px] font-bold text-foreground">Settings</span>
        </header>

        <div className="mx-auto w-full max-w-2xl flex-1 space-y-5 p-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[var(--node-blue)]" />
                <CardTitle>AI usage guardrail</CardTitle>
              </div>
              <CardDescription>
                A hard cap on total chat-mode AI usage — every agent, every transport (this
                canvas's chat, the Salesforce chat widget, and automated channels like WhatsApp)
                — checked before every turn.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {loadState === 'loading' && (
                <div className="flex items-center gap-2 py-4 text-[12.5px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              )}
              {loadState === 'error' && (
                <p className="text-[12.5px] text-destructive">
                  Couldn't load guardrail settings. Reload the page to try again.
                </p>
              )}
              {loadState === 'ready' && status && (
                <>
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <div className="text-[13px] font-medium text-foreground">Enable guardrail</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        When off, usage is still tracked here but never blocks a turn.
                      </div>
                    </div>
                    <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="max-per-day">Max tokens / day</Label>
                      <Input
                        id="max-per-day"
                        type="number"
                        min={0}
                        placeholder="No daily cap"
                        value={maxPerDay}
                        onChange={e => setMaxPerDay(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="max-per-month">Max tokens / month</Label>
                      <Input
                        id="max-per-month"
                        type="number"
                        min={0}
                        placeholder="No monthly cap"
                        value={maxPerMonth}
                        onChange={e => setMaxPerMonth(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                    <UsageBar used={status.tokensUsedToday} cap={status.maxTokensPerDay} label="Used today" />
                    <UsageBar used={status.tokensUsedThisMonth} cap={status.maxTokensPerMonth} label="Used this month" />
                  </div>

                  <div className="flex items-center gap-3">
                    <Button size="sm" className="h-8 text-xs" disabled={saveState === 'saving'} onClick={handleSave}>
                      {saveState === 'saving' && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                      {saveState === 'saving' ? 'Saving…' : 'Save'}
                    </Button>
                    {saveState === 'error' && (
                      <span className="text-[11px] font-semibold text-destructive">Save failed</span>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Salesforce access</CardTitle>
              <CardDescription>How agents authenticate to this org.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {accessLoadState === 'loading' && (
                <div className="flex items-center gap-2 py-4 text-[12.5px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              )}
              {accessLoadState === 'error' && (
                <p className="text-[12.5px] text-destructive">Couldn't load access status.</p>
              )}
              {accessLoadState === 'ready' && access && (
                <>
                  <div className="rounded-lg border border-border p-3">
                    <div className="mb-1 text-[12.5px] font-medium text-foreground">Org connection</div>
                    <p className="mb-2 text-[11.5px] text-muted-foreground">
                      Used by automation, channel, and shared-access agents.
                    </p>
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
                      style={accessPillStyle(access.orgStatus.configured ? 'Connected' : 'Not Connected')}
                    >
                      {access.orgStatus.configured ? 'Connected' : 'Not connected'}
                    </span>
                    {access.orgStatus.configured && (
                      <p className="mt-2 text-[11.5px] text-muted-foreground">
                        Configured by {access.orgStatus.configuredByEmail}
                        {access.orgStatus.configuredAt && ` · ${new Date(access.orgStatus.configuredAt).toLocaleString()}`}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate('/setup')}
                      className="mt-2 text-[11px] font-medium text-primary hover:underline"
                    >
                      {access.orgStatus.configured ? 'Manage connection' : 'Connect now'} →
                    </button>
                  </div>

                  <div className="rounded-lg border border-border p-3">
                    <div className="mb-1 text-[12.5px] font-medium text-foreground">Per-user connections</div>
                    <p className="mb-2 text-[11.5px] text-muted-foreground">
                      Users who've connected their own Salesforce identity for PerUser-mode agents.
                    </p>
                    {access.userConnections.length === 0 ? (
                      <p className="py-3 text-center text-[12px] text-muted-foreground">
                        No one has connected their own Salesforce identity yet.
                      </p>
                    ) : (
                      <div className="overflow-hidden rounded-md border border-border">
                        <table className="w-full text-[12px]">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="px-2.5 py-1.5 text-left font-medium text-foreground">User</th>
                              <th className="px-2.5 py-1.5 text-left font-medium text-foreground">Status</th>
                              <th className="px-2.5 py-1.5 text-left font-medium text-foreground">Account</th>
                            </tr>
                          </thead>
                          <tbody>
                            {access.userConnections.map(u => (
                              <tr key={u.userName} className="border-t border-border">
                                <td className="px-2.5 py-1.5 font-medium text-foreground">{u.userName}</td>
                                <td className="px-2.5 py-1.5">
                                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={accessPillStyle(u.status)}>
                                    {u.status}
                                  </span>
                                </td>
                                <td className="px-2.5 py-1.5 text-muted-foreground">{u.accountEmail ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
