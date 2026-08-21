# Archon → LangChain/LangGraph Replica

A feature-by-feature re-implementation of the Archon agent runtime on
**LangChain** (model layer) + **LangGraph** (orchestration), built for
side-by-side review against the hand-rolled `server/` implementation.
Same agent data model, different engine underneath.

## Run it

```bash
npm install
cp .env.example .env    # PROVIDER=demo works offline, no API key needed
npm run demo            # scripted: handoff → approval interrupt → resume → answer
npm run chat            # interactive REPL against the same sample agent
```

With a real key: set `PROVIDER=openai` (or `anthropic` / `google`) and the
matching `*_API_KEY` in `.env` — nothing else changes. That one-line switch
IS the model-portability claim, live.

## What maps to what

| Archon (hand-rolled, `server/`)                     | Replica (LangChain/LangGraph)                  | Lines |
|-----------------------------------------------------|------------------------------------------------|-------|
| `chat/adapters/runOpenAiAdapter.ts` + `runClaudeAdapter.ts` (~600 lines, per-provider wire formats, continuation contracts) | `src/model-provider.ts` — one `switch`, library handles wire formats | ~40 |
| `chat/subagent-router.ts` (subagents-as-tools routing) | handoff tools + `Command` routing in `src/graph-compiler.ts` | ~30 |
| `chat/chat-engine.ts` (graph walk, tool merge, turn loop) | `compileAgentGraph()` — StateGraph with router/tools/subagent nodes | ~150 |
| Per-provider tool schema encoding (`buildFunctionTools` etc.) | `tool()` + zod, written ONCE in `src/tools.ts` | — |
| Approval flow: `ApprovalToken__c` + pause + resume endpoint + polling | `interrupt()` in `withApproval()` + `new Command({ resume })` | ~25 |
| `ChatSession__c`/`ChatMessage__c` turn history reload | checkpointer thread (`thread_id`) — history + paused state per session | 1 line |
| Tool-results-must-survive-history fix (ChatPanel tool-memory) | free — ToolMessages live in the checkpointed message state | 0 |

The graph JSON in `sample-agents/viva-money.json` is deliberately the same
shape the canvas saves to Salesforce (`AgentNode__c` + `CanvasJson__c`),
including the `fromPort: 'tool'` wiring rule and port-agnostic catalogs —
`src/graph-compiler.ts` enforces identical semantics, so both runtimes
agree on what any saved graph means.

## Reading order

1. `src/types.ts` — the unchanged data model.
2. `src/model-provider.ts` — provider switching in one function.
3. `src/tools.ts` — zod tools + the `interrupt()` approval wrapper.
4. `src/graph-compiler.ts` — the core: spec → StateGraph (router,
   handoffs, ReAct subagents, checkpointer).
5. `src/chat-cli.ts` — driving a turn, catching interrupts, resuming.
6. `src/demo-model.ts` — offline scripted model (skippable; it exists so
   the mechanics run without API spend).

## What this stage does NOT cover (honest gaps)

- **Live MCP tools** — `tools.ts` returns mock Salesforce data. Stage 2
  swaps tool bodies for `@langchain/mcp-adapters` against the real MCP
  server; the graph code doesn't change.
- **Durable persistence** — `MemorySaver` is in-process. Stage 3 swaps in
  `PostgresSaver` (one line) so paused approvals survive restarts.
- **Everything Salesforce-side** — Apex REST, FLS/`WITH USER_MODE`,
  guardrail token caps, WhatsApp bridge, the React builder. A framework
  replaces none of that; it would be shared by both runtimes.
- **Trigger-mode orchestrator** (`orchestrator/engine.ts`) — Stage 4:
  logic/action nodes as plain StateGraph nodes with conditional edges.
- **Streaming, token accounting, guardrails hooks** — Stage 3 territory
  (`graph.stream()` + usage metadata callbacks).

## Roadmap

| Stage | Scope | Proves |
|-------|-------|--------|
| 1 (this) | Router + subagents + tools + approval interrupt, offline demo | Core semantics port cleanly; provider switching is config |
| 2 | Live MCP via `@langchain/mcp-adapters`; real Salesforce tools | Tool layer parity with live data |
| 3 | `PostgresSaver` checkpointing; `/api/chat/turn`-compatible HTTP endpoint; streaming | Drop-in behind the existing Apex client; durable approvals |
| 4 | Trigger-mode graphs (logic/action nodes) | Full runtime parity |
| 5 | Side-by-side eval: same agent, both runtimes, compare answers/latency/tokens | The actual adoption decision |
