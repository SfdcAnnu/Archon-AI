import { apexFetch } from './apex-client';
import type { AgentGraph } from '@/types/agent';
import type { GeneratorMode } from './agent-generator-data';

/** Talks to AgentCopilotRestService.cls, a thin passthrough to the Archon
 *  Node server's /api/agent/copilot (server/src/agent-generator/copilot.ts).
 *  See that file for the tool-calling logic — this layer just shapes the
 *  current graph into the request body and types the response. */
const COPILOT_BASE = '/services/apexrest/agent-builder/copilot/';
const COPILOT_TIMEOUT_MS = 45000;

export interface CopilotTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface CopilotOperation {
  tool: string;
  input: Record<string, unknown>;
}

export interface CopilotResponse {
  operations: CopilotOperation[];
  assistantText: string;
}

export async function askCopilot(
  graph: AgentGraph,
  mode: GeneratorMode,
  message: string,
  history: CopilotTurn[]
): Promise<CopilotResponse> {
  return apexFetch<CopilotResponse>(
    COPILOT_BASE,
    {
      method: 'POST',
      body: JSON.stringify({
        mode,
        agent: {
          name: graph.agent.name,
          department: graph.agent.department,
          description: graph.agent.description,
        },
        nodes: graph.nodes.map(n => ({
          id: n.id,
          label: n.name,
          nodeType: n.nodeType,
          nodeSubType: n.nodeSubType,
          config: n.config,
        })),
        connections: graph.connections.map(c => ({
          id: c.id,
          fromNodeId: c.fromNodeId,
          fromPort: c.fromPort,
          toNodeId: c.toNodeId,
          toPort: c.toPort,
        })),
        message,
        history,
      }),
    },
    COPILOT_TIMEOUT_MS
  );
}
