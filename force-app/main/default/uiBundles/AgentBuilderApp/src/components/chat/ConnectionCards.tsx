import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ConnectionRequirement } from '@/lib/chat-data';
import type { NeedsConnection } from '@/lib/ws-chat';

/** What a person reads next to a connector they have not connected. */
export function requirementLine(r: ConnectionRequirement): string {
  switch (r.status) {
    case 'expired': return 'Your sign-in expired — sign in again.';
    case 'wrong_account': return r.message ?? 'Signed in with an account this org does not allow.';
    case 'needs_group': return r.message ?? "Your team's account is not connected yet — ask your admin.";
    default: return r.runAs === 'group' ? "Your team's account is not connected yet — ask your admin." : 'Not connected yet.';
  }
}

/** One connector to connect, before the chat can start. */
export function ConnectRow({ r, busy, onConnect }: { r: ConnectionRequirement; busy: boolean; onConnect: () => void }) {
  const canConnect = r.runAs === 'user' && r.status !== 'needs_group';
  return (
    <div className="chat-connect-row">
      <div className="who">
        <b>{r.displayName}</b>
        <span>{requirementLine(r)}</span>
      </div>
      {!r.required && <span className="opt">optional</span>}
      {canConnect && (
        <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={onConnect}>
          {busy ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Waiting for sign-in…</> : r.status === 'expired' || r.status === 'wrong_account' ? 'Sign in again' : `Connect my ${r.displayName}`}
        </Button>
      )}
    </div>
  );
}

/** Under a reply: the connectors the turn went without because the
 *  person has no account on them. Connecting here carries on the chat. */
export function NeedsConnectionCard({ items, names, busy, onConnect }: {
  items: NeedsConnection[];
  names: Record<string, string>;
  busy: string | null;
  onConnect: (provider: string, displayName: string) => void;
}) {
  return (
    <div className="chat-connect-card" role="status">
      <div className="hd">The agent could not act as you on {items.length === 1 ? names[items[0].provider] ?? items[0].provider : 'these'}</div>
      {items.map(n => {
        const name = names[n.provider] ?? n.provider;
        return (
          <div key={n.provider} className="chat-connect-row">
            <div className="who">
              <b>{name}</b>
              <span>{n.message}</span>
            </div>
            {n.wanted === 'user' ? (
              <Button size="sm" className="h-7 text-xs" disabled={busy === n.provider} onClick={() => onConnect(n.provider, name)}>
                {busy === n.provider ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Waiting…</> : n.reason === 'expired' ? 'Sign in again' : `Connect my ${name}`}
              </Button>
            ) : (
              <span className="opt">ask your admin</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
