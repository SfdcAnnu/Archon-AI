import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle, CheckCircle2, Clock, Database, FilePlus2, FileSearch, GitBranch, ListTodo, Mail, MessageSquareText, PencilLine, Repeat, Variable, Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentConnection, AgentNode } from '@/types/agent';
import { flowNodeProblems, flowNodeSummary, outputPortsFor } from '@/lib/flow-nodes';
import { HANDLE_BASE, NODE_CARD_BASE, NODE_ICON_SQUARE, accentStripStyle, accentStyle, selectedRing, type NodeAccent } from './node-styles';

/** One step of an automation: a logic step (branch, loop, wait, approval,
 *  variable) or an action (record work, Chatter, a connector tool). Each
 *  exit is its own labelled handle on the right, so a branch or a loop is
 *  wired exactly the way the engine walks it. */
const META: Record<string, { icon: LucideIcon; accent: NodeAccent; kind: string }> = {
  if_else: { icon: GitBranch, accent: 'purple', kind: 'If / else' },
  loop: { icon: Repeat, accent: 'purple', kind: 'Loop' },
  wait: { icon: Clock, accent: 'purple', kind: 'Wait' },
  approval: { icon: CheckCircle2, accent: 'purple', kind: 'Approval' },
  set_variable: { icon: Variable, accent: 'purple', kind: 'Set variable' },
  get_record: { icon: FileSearch, accent: 'amber', kind: 'Get record' },
  query_records: { icon: Database, accent: 'amber', kind: 'Query records' },
  create_record: { icon: FilePlus2, accent: 'amber', kind: 'Create record' },
  update_record: { icon: PencilLine, accent: 'amber', kind: 'Update record' },
  create_task: { icon: ListTodo, accent: 'amber', kind: 'Create task' },
  post_chatter: { icon: MessageSquareText, accent: 'amber', kind: 'Post to Chatter' },
  call_tool: { icon: Mail, accent: 'green', kind: 'Connector tool' },
};

export function FlowNode({ data, selected }: NodeProps & { data: { agentNode: AgentNode; connections?: AgentConnection[] } }) {
  const node = data.agentNode;
  const meta = META[node.nodeSubType] ?? { icon: Wrench, accent: 'gray' as NodeAccent, kind: node.nodeSubType };
  const ports = outputPortsFor(node.nodeSubType);
  const problems = flowNodeProblems(node, data.connections ?? []);
  const multi = ports.length > 1;
  return (
    <div
      className={cn(NODE_CARD_BASE, selectedRing(selected), 'relative min-w-[200px] max-w-[260px] px-2.5 py-2', multi && 'pr-16')}
      style={selected ? undefined : accentStripStyle(meta.accent)}
    >
      <Handle type="target" id="in" position={Position.Left} className={HANDLE_BASE} />
      <div className="flex items-center gap-2.5">
        <div className={NODE_ICON_SQUARE} style={accentStyle(meta.accent)}>
          <meta.icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-bold leading-tight text-foreground">{node.name}</div>
          <div className="text-[10px] text-muted-foreground">{meta.kind}</div>
        </div>
      </div>
      <div className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground" title={flowNodeSummary(node)}>{flowNodeSummary(node)}</div>
      {problems.length > 0 && (
        <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-[var(--archon-warning)]" title={problems.join(' · ')}>
          <AlertTriangle className="h-3 w-3 shrink-0" /> <span className="truncate">{problems[0]}</span>
        </div>
      )}
      {ports.map((p, i) => {
        const top = multi ? `${((i + 1) / (ports.length + 1)) * 100}%` : '50%';
        return (
          <div key={p.id}>
            {multi && (
              <span className="pointer-events-none absolute right-3 -translate-y-1/2 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground" style={{ top }}>
                {p.label}
              </span>
            )}
            <Handle type="source" id={p.id} position={Position.Right} className={HANDLE_BASE} style={{ top }} />
          </div>
        );
      })}
    </div>
  );
}
