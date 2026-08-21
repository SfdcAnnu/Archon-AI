/**
 * Tool layer. Two things to compare against the hand-rolled server:
 *
 * 1. ONE definition per tool (zod schema + function). LangChain translates
 *    it to OpenAI's flat function format, Anthropic's input_schema format,
 *    or Gemini's declarations — the per-provider encoding that
 *    buildFunctionTools/mcp bridging code does by hand today.
 *
 * 2. requiresApproval (Archon's write-tool approval flow: ApprovalToken__c
 *    record + pause + resume endpoint + WhatsApp approval message) becomes
 *    LangGraph's interrupt(): the graph FREEZES inside the tool, the run is
 *    checkpointed, and a later `new Command({ resume: decision })` resumes
 *    exactly there — surviving a process restart if a persistent
 *    checkpointer (Postgres) is plugged in. Compare with the hand-rolled
 *    pause/resume spread across AgentChatController, runs.routes.ts and
 *    ApprovalsPage.
 *
 * STAGE 1 NOTE: the Salesforce-shaped tools below return MOCK data so the
 * replica runs standalone. Stage 2 swaps their bodies for live MCP calls
 * via @langchain/mcp-adapters — the graph code does not change.
 */
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';
import { z } from 'zod';

const MOCK_CUSTOMER = {
  Id: '003DEMO000001',
  Name: 'Priya Sharma',
  Mobile: '+91-98xxxxxx21',
  Loans: [{ Id: 'a0LDEMO000007', Product: 'Personal Loan', Amount: 250000, Status: 'Active' }],
};

/** Registry keyed by toolName — what a tool NODE's config.toolName or a
 *  catalog's allowedTools entries resolve against (Archon's equivalent is
 *  the live MCP tools/list + custom-action lookup). */
export function buildToolRegistry(): Map<string, StructuredToolInterface> {
  const registry = new Map<string, StructuredToolInterface>();

  registry.set(
    'soql_query',
    tool(
      async ({ soql }) => {
        // Mock: real impl proxies the MCP server's soqlQuery with the
        // conversation's record scope enforced server-side.
        return JSON.stringify({ records: [MOCK_CUSTOMER], note: `mock result for: ${soql}` });
      },
      {
        name: 'soql_query',
        description: 'Run a read-only SOQL query scoped to this conversation\'s customer.',
        schema: z.object({ soql: z.string().describe('The SOQL query to run') }),
      }
    )
  );

  registry.set(
    'get_object_schema',
    tool(
      async ({ objectName }) => JSON.stringify({ objectName, fields: ['Id', 'Name', 'Mobile'] }),
      {
        name: 'get_object_schema',
        description: 'Describe a Salesforce object\'s fields.',
        schema: z.object({ objectName: z.string() }),
      }
    )
  );

  registry.set(
    'get_related_records',
    tool(
      async ({ recordId, relation }) =>
        JSON.stringify({ parent: recordId, relation, records: MOCK_CUSTOMER.Loans }),
      {
        name: 'get_related_records',
        description: 'Fetch child records related to the verified customer.',
        schema: z.object({ recordId: z.string(), relation: z.string() }),
      }
    )
  );

  registry.set(
    'send_otp',
    tool(
      async ({ mobile }) => `OTP sent to ${mobile} via SMS gateway (mock).`,
      {
        name: 'send_otp',
        description: 'Send a one-time password to the customer\'s registered mobile number.',
        schema: z.object({ mobile: z.string() }),
      }
    )
  );

  return registry;
}

/** Wraps any tool in a human-approval gate. interrupt() throws internally,
 *  LangGraph checkpoints the run, and the caller sees an __interrupt__
 *  payload instead of a result; on `new Command({ resume })` the tool body
 *  re-runs from the top and interrupt() RETURNS the resume value. */
export function withApproval(inner: StructuredToolInterface): StructuredToolInterface {
  return tool(
    async (args: Record<string, unknown>) => {
      const decision = interrupt({
        kind: 'tool_approval',
        toolName: inner.name,
        description: inner.description,
        args,
      }) as { approved: boolean; comment?: string };
      if (!decision.approved) {
        return `The user REJECTED this ${inner.name} call${decision.comment ? ` — reason: ${decision.comment}` : ''}. Do not retry it; acknowledge and ask how else to help.`;
      }
      return (await inner.invoke(args)) as string;
    },
    {
      name: inner.name,
      description: inner.description,
      schema: inner.schema as z.ZodObject<z.ZodRawShape>,
    }
  );
}
