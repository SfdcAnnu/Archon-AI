import type { AgentNode, CatalogNodeConfig } from '@/types/agent';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-[12.5px] leading-relaxed text-foreground/85">{children}</div>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-pre-wrap break-words font-mono text-[11.5px]">{children}</span>;
}

/** Renders a raw config value for display — objects/arrays pretty-printed
 *  as JSON (fieldMappings/paramValues are stored as JSON-text strings that
 *  read better parsed-then-reprinted than as one unbroken line), booleans
 *  as Yes/No, everything else as-is. */
function displayValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-muted-foreground">—</span>;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === 'object') return <Mono>{JSON.stringify(parsed, null, 2)}</Mono>;
    } catch {
      /* not JSON — plain text */
    }
    return v;
  }
  return <Mono>{JSON.stringify(v, null, 2)}</Mono>;
}

const FIELD_LABELS: Record<string, string> = {
  objectType: 'Object', triggerOn: 'Fires on', model: 'Model', instruction: 'Instruction',
  useKnowledgeBase: 'Uses Knowledge Base', condition: 'Condition', variableName: 'Variable name',
  template: 'Template', delayValue: 'Delay', delayUnit: 'Delay unit', approverField: 'Approver field',
  timeoutHours: 'Timeout (hours)', collectionVar: 'Collection', iteratorVar: 'Item name',
  maxIterations: 'Max iterations', fields: 'Fields', fieldMappings: 'Field mappings', soql: 'SOQL query',
  subject: 'Subject', dueDate: 'Due date', priority: 'Priority', message: 'Message', provider: 'Provider',
  connectorId: 'Connector', toolKind: 'Tool kind', toolName: 'Tool name', paramValues: 'Parameters',
  logExecution: 'Logs this run',
};

/** Generic key/value dump of a node's ConfigJson__c — used for every
 *  automation-mode (trigger/ai-step/logic/action) node type so the review
 *  view actually shows what a generated agent does, instead of a hardcoded
 *  placeholder sentence. rationale (set by the generator on proactively-
 *  added nodes) surfaces separately, above the config, when present. */
function ConfigDump({ node, keys }: { node: AgentNode; keys: string[] }) {
  const cfg = node.config as Record<string, unknown>;
  const rationale = (node.config as { rationale?: string })?.rationale;
  return (
    <>
      {rationale && (
        <Row label="Why this step was added">
          <span className="italic text-muted-foreground">{rationale}</span>
        </Row>
      )}
      {keys.map(k => (
        <Row key={k} label={FIELD_LABELS[k] ?? k}>
          {displayValue(cfg?.[k])}
        </Row>
      ))}
    </>
  );
}

const LOGIC_KEYS: Record<string, string[]> = {
  if_else: ['condition'],
  set_variable: ['variableName', 'template'],
  wait: ['delayValue', 'delayUnit'],
  approval: ['approverField', 'timeoutHours'],
  loop: ['collectionVar', 'iteratorVar', 'maxIterations'],
};

const ACTION_KEYS: Record<string, string[]> = {
  get_record: ['objectType', 'fields'],
  update_record: ['objectType', 'fieldMappings'],
  create_record: ['objectType', 'fieldMappings'],
  query_records: ['soql'],
  create_task: ['subject', 'dueDate', 'priority'],
  post_chatter: ['message'],
  call_tool: ['provider', 'toolName', 'paramValues'],
};

/** trigger / ai-step / logic / action nodes are automation-mode's own
 *  vocabulary (see server/src/agent-generator/spec.ts's NODE_SPEC) — the
 *  chat-mode canvas has no editable form for any of them, so this always
 *  renders their real config read-only. Also used for EVERY node type when
 *  PropertiesPanel is in readOnly mode (AutomationReviewView), including
 *  types that normally have an editable form (ai/subagent/tool), so a
 *  Trigger-mode "ai" step node never lands in the chat-mode AiRootForm it
 *  wasn't built for. */
export function ReadOnlySummary({ node }: { node: AgentNode }) {
  if (node.nodeType === 'trigger') {
    return <ConfigDump node={node} keys={['objectType', 'triggerOn']} />;
  }
  if (node.nodeType === 'ai') {
    return <ConfigDump node={node} keys={['model', 'instruction', 'useKnowledgeBase']} />;
  }
  if (node.nodeType === 'logic') {
    return <ConfigDump node={node} keys={LOGIC_KEYS[node.nodeSubType] ?? []} />;
  }
  if (node.nodeType === 'action') {
    return <ConfigDump node={node} keys={ACTION_KEYS[node.nodeSubType] ?? []} />;
  }
  if (node.nodeType === 'end') {
    return <ConfigDump node={node} keys={['logExecution']} />;
  }
  if (node.nodeType === 'catalog') {
    const cfg = node.config as CatalogNodeConfig;
    return (
      <>
        <Row label="Description">{cfg.description}</Row>
        <Row label="Grouped tools">
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(cfg.allowedTools ?? []).map(t => (
              <span
                key={t}
                className="rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10.5px] text-foreground/80"
              >
                {t}
              </span>
            ))}
          </div>
        </Row>
      </>
    );
  }
  // subagent/tool have their own dedicated editable forms (see
  // PropertiesPanel.tsx's routing) — only reached here in readOnly mode.
  return <ConfigDump node={node} keys={Object.keys(node.config as Record<string, unknown>)} />;
}
