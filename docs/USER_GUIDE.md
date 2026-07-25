# Archon AI — User Guide

Audience: anyone building or running agents day-to-day. Assumes setup from [CONFIGURATION_GUIDE.md](./CONFIGURATION_GUIDE.md) is already done (org authorized, at least one AI Engine Connection available, permission sets assigned).

> **Updated 2026-07-24 — changes from a round of hands-on testing feedback:**
> - Only 2 permission sets now (`AgentBuilderUser`/Archon Admin, `AgentChatUser`/Archon Agent Invoker) — see the Configuration Guide.
> - **Archon Setup** and **Archon Chat** are now app tabs (were previously App-Launcher-only). Archon Setup has two tabs of its own: **Salesforce Setup** (the org OAuth handshake) and **AI Provider Setup** (add/manage AI Engine Connections in one place — no longer only reachable from inside an AI node's config).
> - Test Runner now works on Draft agents (previously required Active).
> - The Actions palette has 6 new simple, dedicated nodes (Get/Query/Create/Update Record, Create Task, Post to Chatter) — no connector/tool picker needed for basic CRUD. "Call a Tool (Connector)" is still there for anything else.
> - Every config field that accepts a `{!variable}` now has a 🔤 button right next to it to insert one — including new `{!user.*}` and `{!org.*}` tokens. The old "click a field, switch to the Variables tab, click a variable" flow is gone.
> - Knowledge Base → Documents no longer requires a manual Save-then-reopen round trip on a brand-new agent — opening it auto-saves a Draft first.
> - You can now add a **custom MCP server** (any URL) from the Connectors directory — same idea as Claude's own "add a custom MCP server," no packaged catalog entry required.
> - There is no shared/default AI provider key anymore — every agent needs a real AI Engine Connection bound, or AI nodes fail with a clear error instead of silently using Archon's own key.

---

## 1. Two ways to build an agent

Open the **Agent Home** tab and click **New Agent**. You get an empty canvas with two options:

1. **Drag and drop manually** — build the graph node by node yourself. Full control.
2. **Describe your agent** — paste a plain-English requirement (optionally attach a `.txt`/`.md`/`.csv` requirements document), and Archon's own AI reads it and builds the graph for you. Covered in section 9.

Both paths land you on the exact same canvas with the exact same editing tools — an AI-generated agent is not a special read-only thing, it's a normal draft you can keep editing by hand.

---

## 2. Canvas basics

- **Nodes** are dragged from the palette onto the canvas. Click a node to open its config in the right-hand **Properties Panel**.
- **Ports** are the connection points on a node's edges. Drag from one node's output port to another node's input port to wire them. Most nodes have a single `out` port; a few branch (see below).
- **Save** (bottom of canvas) persists the agent and every node/connection. Nothing is live until you save, and nothing runs until the agent's Status is flipped to **Active** (new agents — including AI-generated ones — always save as **Draft**; this is a deliberate safety net, not a bug to work around).

---

## 3. Node reference

### Trigger (exactly one per agent)
| Subtype | Config |
|---|---|
| `record` | `objectType` (e.g. `Lead`), `triggerOn` (Create / Update / Create or Update) |
| `schedule` | `cronExpression` (e.g. `0 0 8 * * ?`) |
| `webhook`, `platform_event` | fire from outside Salesforce / from a platform event |

### AI (the reasoning step — picks and calls tools from any catalog nodes wired downstream)
All three share the same shape: `instruction` (plain English — what should this step accomplish and decide), optional `systemPrompt` override, `useKnowledgeBase` toggle, `fewShotExamples`, `dispatchMode` (`two_tier` = pick a catalog then a tool, best with many catalogs; `flat` = every tool visible at once), `maxToolCalls`, `captureReasoning`.

| Subtype | Models | Extra fields |
|---|---|---|
| `claude` | claude-opus-4-7 / claude-sonnet-4-6 / claude-haiku-4-5 | `effort` (low/medium/high/max), `adaptiveThinking`, `maxTokens` |
| `gpt4` | gpt-4o / gpt-4o-mini / gpt-4-turbo / gpt-4.1 / gpt-4.1-mini | `temperature`, `maxTokens` |
| `gemini` | gemini-2.5-pro / gemini-2.5-flash / gemini-2.0-flash / gemini-2.0-flash-lite | `temperature`, `maxTokens` |

Which AI key actually gets used at runtime follows the resolution order in the Configuration Guide (§8) — the user's own personal key first, then a node-bound key, then a shared org key.

### Logic
| Subtype | Ports | Config |
|---|---|---|
| `if_else` | `yes` / `no` | `condition` — built via the visual condition builder (pick a field/variable token, an operator, a value) or typed directly, e.g. `{!ai.score} > 80` |
| `set_variable` | `out` | `variableName` (letters/numbers, no spaces), `template` (the value — plain text or `{!tokens}`, combine several). Reference it downstream as `{!variableName.value}`. Every Set Variable node on the canvas automatically shows up as a click-to-insert token in the **Variables** tab of any downstream node's condition/template fields. |
| `wait` | `out` | `delayValue` + `delayUnit` (seconds/minutes/hours/days). **60 seconds or less runs inline**; anything longer pauses the run *durably* — the pause survives a server restart and resumes on its own via the run poller, no manual intervention needed. |
| `approval` | `approved` / `rejected` | `approverField` (e.g. `OwnerId` — resolved against the triggering record), `timeoutHours`. Creates an `AgentApproval__c` record; the approver sees it under **My Approvals** (see §12) and can Approve, Reject, or add a comment. If nobody decides within `timeoutHours`, the run auto-resolves as rejected/timed out. |
| `loop` | `each` / `done` | `collectionVar` (must resolve to a list — e.g. a `query_records` node's output), `iteratorVar` (reference the current item downstream as `{!item.FieldName}`), `maxIterations` (hard-capped at 100 regardless of what you enter). **Loop bodies cannot contain another Wait, Approval, or nested Loop node** — the engine enforces this at runtime, and AI generation is instructed never to produce it. |

### Action (direct Salesforce writes/reads — no AI reasoning involved, run exactly as configured every time)
| Subtype | Config |
|---|---|
| `get_record` | `objectType`, `fields` (comma-separated) |
| `update_record` | `objectType`, `fieldMappings` (JSON, e.g. `{"Status__c": "Hot", "Score__c": "{!ai.score}"}`) |
| `create_record` | `objectType`, `fieldMappings` (JSON) |
| `query_records` | `soql` (e.g. `SELECT Id, Name FROM Lead WHERE Id = '{!recordId}'`) |
| `create_task` | `subject`, `dueDate` (e.g. `TODAY+1`), `priority` |
| `post_chatter` | `message` (supports tokens, e.g. `Lead scored {!ai.score} — action required`) |
| `apex_action` | `className`, `methodName` — invokes a custom Invocable Apex class in your org |

These are the nodes an AI-generated agent typically wires directly after an `if_else` branch for simple, deterministic outcomes — no AI call needed for a plain "post a Chatter note" or "update a field" step. See §10 for when to use these vs. a Call-a-Tool node driven by AI.

### Call a Tool (`call_tool`) — one specific action, chosen by you, not the AI
Pick a **connected provider** from the picklist (populated from your Connectors directory), then either:
- **Standard tool** — Archon fetches the live tool list *with schemas* from that provider's MCP server and shows it as a searchable picker (e.g. Salesforce MCP's `list_sobjects`, `run_report`, `create_record`, etc.). Once picked, the parameter form is generated straight from that tool's real input schema — nothing hardcoded.
- **Custom — my org's Apex action / Flow** (Salesforce provider only) — pick from your org's own Invocable Apex classes / Flows, again with a live-fetched parameter schema.

This node is for when *you* (not the AI) decide exactly which tool call happens and with what parameters — contrast with a Catalog node below, where the AI decides.

### Catalog nodes (`salesforce_crm_tools`, `storage_tools`, `email_tools`, `channel_tools`)
Wire one of these downstream of an AI node to hand it a whole toolbox rather than one fixed call. Config: a `description` (shown to the AI when it's deciding whether to use this catalog — keep it short and specific), a `connectorId`, and `allowedTools` — a multiselect allowlist. Reads (list/get/search) are unrestricted; writes (create/update/delete/send/post) are flagged in the UI as needing the approval story (Approval node, §above) if you want a human checkpoint before they fire.

### End
`logExecution` toggle — whether this run's outcome gets logged back to `AgentExecution__c`.

---

## 4. Knowledge Base (per agent)

Open an agent → **Knowledge base**.
- **Notes tab** — plain-English rules, always sent in full on every AI call. Good for short, standing instructions (e.g. "Hot leads (score > 80) must be assigned to the AE via Slack").
- **Documents tab** — longer reference material (FAQs, policy docs). These are chunked, embedded, and retrieved by relevance rather than pasted in full each time. Pick a **storage backend** here per agent (Archon default / your own Postgres / your Salesforce org — see Configuration Guide §10) before adding documents; you can test a Postgres connection string in-UI before saving. Add a document by pasting its title + text; each shows an indexing status badge and chunk count, and can be reindexed or deleted.

An AI node only actually consults the KB if its `useKnowledgeBase` toggle is on.

---

## 5. Testing an agent

**Builder → open an agent → Test** opens the **Test Runner**: pick/paste a real Salesforce record Id (any Lead/Case/Opportunity Id works as long as it matches your trigger's object), choose a run mode, optionally supply extra input JSON, and click Run. You get a live execution log and a result summary (Status, Correlation ID, elapsed time). Note: the **Score / Priority** fields on the result are optional, legacy-shaped fields a scoring-style agent can populate — for agents that don't compute a score (e.g. a pure notify-and-log agent), they'll simply read 0/blank, which is expected, not a failure.

For anything involving a Wait longer than 60s, an Approval, or a Loop, the Test Runner shows the *initial* run only — go to **Execution Logs** (or **My Approvals**) to watch it resume, since those pause the run outside the request/response cycle by design.

---

## 6. Going live

Flip an agent's **Status** to **Active** once you're satisfied. Only Active agents respond to their trigger (record change, schedule, webhook, platform event) — this gate is enforced both by the record-trigger dispatch and inside `executeAgent` itself, so there's no path to accidentally running a Draft agent against real data.

---

## 7. Durable execution — what actually happens on Wait/Approval/Loop

Long waits and approvals don't hold a server thread open. The engine pauses, writes the pause state (`AgentRun`/`RunStep`), and a background poller (checks every 15 seconds, plus a sweep on server boot) picks paused runs back up when they're due — a Wait that outlives a server restart or redeploy still resumes correctly on its own. Practically: don't expect a long-Wait or Approval-gated agent to "finish" in the Test Runner's single request — check Execution Logs / My Approvals afterward.

---

## 8. My Approvals

Anyone who can be an approver target sees pending items under **My Approvals**: the record context, the AI's reasoning up to that point, an optional comment field, and **Approve** / **Reject** buttons. Deciding resumes the paused run down the matching branch immediately.

---

## 9. AI Agent Generation ("Describe your agent")

From the empty-state canvas, click **Describe your agent**:
1. Type your requirement in plain English (mention the triggering object, what should be decided, what should happen) and/or attach a `.txt`/`.md`/`.csv` requirements doc.
2. Click **Generate**. Archon's AI (Claude Sonnet) either:
   - Asks **1–2 clarifying questions** if something genuinely load-bearing is ambiguous (e.g. no named approver, no threshold) — answer them and click **Continue**. There's at most one such round-trip; after that it generates its best-guess draft regardless and flags any remaining open questions in the checklist instead of blocking further.
   - Or generates the **complete agent** directly — nodes, wiring, and positions, dropped onto the canvas exactly as if you'd built it by hand.
3. Review the **setup checklist** that comes with it — a mix of items Archon verifies automatically (e.g. "Slack connector: Connected" flips green the moment you actually connect Slack) and manual items requiring your judgment (e.g. "confirm the approver field matches a real field on your Lead layout"). Nodes the AI added proactively beyond your literal wording (e.g. a rejection branch you didn't explicitly ask for) carry a one-line rationale so "why is this node here" is always answerable.
4. Edit anything you like on the canvas exactly as you would a hand-built agent, then **Save**. It saves as Draft — review and activate when ready.

If the server is waking from an idle period (see Configuration Guide, cold-start note), the modal shows "waking up" and retries quietly rather than surfacing raw HTML.

**What generation deliberately does *not* do**: it won't keep refining an already-generated graph conversationally ("also add an approval step" after the fact) — further changes past generation go through the normal manual editor, same as any hand-built agent. It also doesn't read PDF/DOCX documents in this version — plain text formats only.

---

## 10. A note on when AI is actually doing something vs. plain automation

Not every generated agent needs an AI node. If a requirement is pure "when X happens, do Y" with no judgment call, generation may correctly wire trigger → action node directly (e.g. `record` trigger → `post_chatter`/`update_record`) with **no AI node at all** — that's equivalent to what a Salesforce Flow could do natively, and there's no reason to force an unnecessary AI call into a deterministic path. AI nodes exist for the parts that genuinely need judgment, unstructured-input reading, tool selection across multiple providers, or synthesis (e.g. "score this lead," "answer a question against our policy docs," "decide which tool to call based on the conversation") — that's where Archon's actual advantage over hand-built Flow logic shows up: AI-key resolution, pluggable RAG, cross-provider tool-calling (Managed MCP), and English-to-agent generation, not the ability to update a field.

---

## 11. Chat

**Synapse Chat** tab (find via App Launcher if not pinned) lets any user with record access to an `AgentDefinition__c` start a conversational session with it — agent picker, session sidebar, message list, and an **End** button for explicit session close (sessions also expire on a 24-hour sliding window of inactivity). An embedded chat panel (`synapseChatPanel`) is also available to drop onto record pages for in-context conversations tied to that record.

---

## 12. Sharing agents

**Share** on an agent opens a modal to grant specific users/groups access beyond default org-wide-private sharing — search, add, and see everyone currently shared with, with the ability to remove access. This is enforced via a custom Apex sharing reason, independent of profile-level CRUD.

---

## 13. Execution Logs

**Builder → open an agent → Execution Logs**: a paged, exportable (CSV) history of every run — status, timing, correlation ID, and (for AI steps) which tools were used and the reasoning captured, if `captureReasoning` was on. This is the most reliable way to confirm what actually happened on a run that involved a Wait/Approval/Loop pause-resume cycle, since those don't complete inside a single Test Runner click.
