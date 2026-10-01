import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cachedIdentityPolicy, type IdentityPolicy } from '@/lib/identity-data';
import type { CatalogNodeConfig } from '@/types/agent';

/** The node's identity policy: whose account this connector runs as.
 *  Unset keys follow the org's default (Settings → Identity & access), so
 *  most nodes never touch this; the section says what the default is. */
export function IdentityFields({ cfg, onConfigChange }: { cfg: CatalogNodeConfig; onConfigChange: (patch: Partial<CatalogNodeConfig>) => void }) {
  const [org, setOrg] = useState<IdentityPolicy | null>(null);
  useEffect(() => {
    let cancelled = false;
    cachedIdentityPolicy().then(r => !cancelled && setOrg(r.policy)).catch(() => { /* the default is shown as "org default" */ });
    return () => { cancelled = true; };
  }, []);

  const effectiveRunAs = cfg.runAs ?? org?.defaultRunAs ?? 'user';
  const isSalesforce = cfg.provider === 'salesforce_mcp' || cfg.provider === 'salesforce_metadata';

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5">
        <UserRound className="h-3.5 w-3.5 text-[var(--node-blue)]" />
        <Label className="text-[11px] font-bold">Options</Label>
        <span className="text-[10px] text-muted-foreground">— for each user's own account</span>
      </div>
      {isSalesforce && <p className="text-[10px] leading-snug text-muted-foreground">For Salesforce, automatic sign-in (JWT) spares people a personal connection when it is set up.</p>}

      {effectiveRunAs !== 'org' && effectiveRunAs !== 'connection' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-[10.5px] font-semibold text-muted-foreground">When the person has no connection</Label>
            <Select value={cfg.fallback ?? 'default'} onValueChange={v => onConfigChange({ fallback: v === 'default' ? undefined : (v as CatalogNodeConfig['fallback']) })}>
              <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Org default{org ? ` — ${org.defaultFallback === 'org' ? 'use the org connection' : 'refuse'}` : ''}</SelectItem>
                <SelectItem value="none">Refuse — ask them to connect</SelectItem>
                <SelectItem value="org">Use the org connection instead</SelectItem>
              </SelectContent>
            </Select>
            {org?.blockOrgFallbackForChat && (cfg.fallback ?? org.defaultFallback) === 'org' && (
              <p className="text-[10px] leading-snug text-[var(--archon-warning)]">The org policy blocks this fallback in chat: chats will still ask the person to connect.</p>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-[11px]">
            <input type="checkbox" className="mt-0.5 h-3.5 w-3.5" checked={cfg.required !== false} onChange={e => onConfigChange({ required: e.target.checked ? undefined : false })} />
            <span>
              <span className="font-semibold text-foreground">Required to chat</span>
              <span className="block text-[10px] text-muted-foreground">Off: the chat opens and the agent works without this connector until they connect it.</span>
            </span>
          </label>

          <div className="space-y-1.5">
            <Label className="text-[10.5px] font-semibold text-muted-foreground">Only accounts on this domain</Label>
            <Input value={cfg.allowedDomain ?? ''} onChange={e => onConfigChange({ allowedDomain: e.target.value.trim() || undefined })} placeholder={org?.allowedDomains?.length ? `Org default: ${org.allowedDomains.join(', ')}` : 'e.g. acme.com — empty allows any'} className="h-8 text-xs" />
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label className="text-[10.5px] font-semibold text-muted-foreground">Automations (Flow and Apex runs)</Label>
        <Select value={cfg.automationRunAs ?? 'default'} onValueChange={v => onConfigChange({ automationRunAs: v === 'default' ? undefined : (v as CatalogNodeConfig['automationRunAs']) })}>
          <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Org default{effectiveRunAs === 'org' ? ' — the org' : " — the record's user"}</SelectItem>
            <SelectItem value="triggeringUser">The user who triggered the run</SelectItem>
            <SelectItem value="group">Their group's account</SelectItem>
            <SelectItem value="org">The org connection</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] leading-snug text-muted-foreground">A run that cannot act as its person fails with a reason and sends them a reminder to connect.</p>
      </div>
    </div>
  );
}
