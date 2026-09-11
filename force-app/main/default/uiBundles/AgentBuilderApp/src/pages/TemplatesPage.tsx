import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { IconSquare } from '@/components/spec/blocks';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { createAgent } from '@/lib/agents-data';

/** Approved spec screen 09 — three starter templates. "Use template"
 *  reuses the existing create-agent path (createAgent → canvas): it
 *  creates a named starter agent (one AI node + read-only Salesforce
 *  tools) in the template's department and opens it on the canvas. The
 *  caption under the grid says exactly that — no pretend pre-built graph. */

interface Template {
  key: string;
  name: string;
  department: string;
  glyph: string;
  bg: string;
  color: string;
  description: string;
}

const TEMPLATES: Template[] = [
  {
    key: 'lost-deal-revival',
    name: 'Lost deal revival',
    department: 'Sales',
    glyph: '♟',
    bg: 'var(--node-purple-tint)',
    color: 'var(--node-purple)',
    description: 'Re-opens closed-lost opportunities over WhatsApp and hands off to a specialist.',
  },
  {
    key: 'case-deflection',
    name: 'Case deflection',
    department: 'Support',
    glyph: '☑',
    bg: 'var(--node-teal-tint)',
    color: 'var(--node-teal)',
    description: 'Answers common questions from your knowledge base before a case is created.',
  },
  {
    key: 'renewal-risk-sweep',
    name: 'Renewal risk sweep',
    department: 'Success',
    glyph: '⌁',
    bg: 'var(--archon-warning-tint)',
    color: 'var(--node-amber)',
    description: 'Scores a whole book of accounts in parallel, one sub-agent per account.',
  },
];

export default function TemplatesPage() {
  const navigate = useNavigate();
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  const useTemplate = (t: Template) => {
    if (creatingKey) return;
    setCreatingKey(t.key);
    createAgent(t.name, t.department)
      .then(apiName => {
        toast.success(`"${t.name}" starter agent created — build out its graph on the canvas.`);
        navigate(`/agent/${apiName}`);
      })
      .catch(err => {
        console.error('Failed to create agent from template:', err);
        toast.error('Could not create the agent', {
          description: err instanceof Error ? err.message : 'See console for details.',
        });
        setCreatingKey(null);
      });
  };

  return (
    <AppShell title="Templates">
      <div className="mx-auto w-full max-w-5xl p-5">
        <div className="grid grid-cols-3 gap-3.5">
          {TEMPLATES.map(t => (
            <div key={t.key} className="rounded-lg border border-border bg-card p-4">
              <IconSquare bg={t.bg} color={t.color}>
                <span className="text-[15px] leading-none">{t.glyph}</span>
              </IconSquare>
              <b className="mt-3 block text-[13px] text-foreground">{t.name}</b>
              <p className="mb-3 mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                {t.description}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-[11.5px]"
                disabled={creatingKey != null}
                onClick={() => useTemplate(t)}
              >
                {creatingKey === t.key && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                {creatingKey === t.key ? 'Creating…' : 'Use template'}
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-[var(--archon-faint)]">
          Today each template creates a named starter agent (one AI node + a read-only Salesforce
          tool) in its department and opens the canvas — the template-specific graph is built there.
        </p>
      </div>
    </AppShell>
  );
}
