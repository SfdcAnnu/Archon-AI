# Chat Agent — Architecture & Build Plan

Status: Confirmed (ready to build Phase 1)
Owner: Synapse AI
Last updated: 2026-06-08

---

## Why this exists

Today agents can only be invoked from triggers (record-level callout,
fire-and-forget). There's no way for a human to *talk* to an agent — ask
follow-up questions, refine intent, or steer the agent across multiple turns.

This document describes a second execution mode — **Chat Agent** — where the
same agent definition that triggers run can also be invoked through a
conversational UI inside Salesforce. Multi-turn, with tool use, with optional
record context.

---

## Locked decisions (per Annu, 2026-06-08)

| Question | Answer |
|---|---|
| Who can chat? | **Anyone with SF record-level access to `AgentDefinition__c`.** No special perm set; rely on standard SF sharing. |
| Where does chat history live? | **Salesforce custom SObjects** (`ChatSession__c` + `ChatMessage__c`). Customer can build reports, query, audit. |
| Session lifetime? | **24-hour sliding expiry** based on last activity. Manual **End** button on the chat UI for explicit close. |
| Cost cap per user? | None in Phase 1 — revisit later. |
| Tool gating? | **Option C — full power with approval modal for writes.** Reads run instantly. Writes pause and surface a confirmation dialog in the chat UI before the AI's tool call executes. |
| Agent picker scope? | All agents the user has record access to, with filter / search controls in the UI. |
| Concurrent / shared chat? | **Per user, per agent.** Each user has their own thread with each agent. |

---

## High-level shape

```
┌─ Salesforce ────────────────────────────────────────────────────┐
│                                                                 │
│   ┌─ Standalone "Synapse Chat" tab ──────────────────────────┐ │
│   │  synapseChat LWC                                         │ │
│   │   ├─ agent picker + filter (top)                         │ │
│   │   ├─ recent sessions sidebar (left)                      │ │
│   │   ├─ message list (middle)                               │ │
│   │   └─ input + send + End-session (bottom)                 │ │
│   └────────────────┬─────────────────────────────────────────┘ │
│                    │                                            │
│   ┌─ Embedded floating widget on record pages ───────────────┐ │
│   │  synapseChatWidget LWC                                   │ │
│   │   └─ same panel UI, pinned bottom-right, recordId passed │ │
│   └────────────────┬─────────────────────────────────────────┘ │
│                    │                                            │
│   ┌─ Apex AgentChatController.cls ──────────────────────────┐ │
│   │  startSession(agentApiName, recordId)                    │ │
│   │  sendTurn(sessionId, userText)                           │ │
│   │  getSession(sessionId)                                   │ │
│   │  listMySessions()                                        │ │
│   │  endSession(sessionId)                                   │ │
│   │  listChatEnabledAgents(filter)                           │ │
│   └────────────────┬─────────────────────────────────────────┘ │
│                    │                                            │
│   ┌─ SF custom SObjects (chat lives here) ──────────────────┐ │
│   │  ChatSession__c                                          │ │
│   │  ChatMessage__c  (master-detail to session)             │ │
│   └────────────────┬─────────────────────────────────────────┘ │
└────────────────────┼────────────────────────────────────────────┘
                     │ HTTPS (existing sessionAuth Bearer)
                     ▼
┌─ Synapse Node server ───────────────────────────────────────────┐
│                                                                 │
│   POST /api/chat/turn          (sessionAuth)                    │
│     Body: { agentApiName, sessionId,                            │
│             history: [...], newUserMessage,                     │
│             context: { recordId, userId } }                     │
│     Returns:                                                    │
│       { assistantMessage,                                       │
│         toolCalls: [{name, args, result, isError}],             │
│         modelUsed, tokensIn, tokensOut }                        │
│                                                                 │
│   Server is STATELESS for chat. No DB rows for sessions/        │
│   messages. SF owns all history. Server just:                   │
│     1. Loads agent definition (cached from SF)                  │
│     2. Walks the agent's graph in chat mode                     │
│     3. AI orchestrator gets [system, ...history, newUser]       │
│     4. Tool calls flow through dispatcher → MCP / catalogs      │
│     5. Returns the assistant turn + tool log                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Why history lives in Salesforce

Confirmed by Annu: customers want to build reports, query chats, and audit
conversations using standard SF tools. So chat data must live in their org.

Implications:
- Two new SObjects, both private sharing.
- Server becomes stateless w.r.t. chat — every turn includes the full history
  in the request body. The server just executes one turn and returns.
- Storage usage = SF storage usage. Sessions expire in 24h so size stays bounded.
- Standard List Views, Reports, Dashboards all work out of the box.

---

## Data model — Salesforce

### `ChatSession__c`

Header row — one per conversation a user has with an agent.

| Field | Type | Notes |
|---|---|---|
| `Name` | Auto-number `CHAT-{0000}` | |
| `AgentDefinition__c` | Lookup → `AgentDefinition__c` | Which agent the chat is with |
| `User__c` | Lookup → User | The chatter. Restrict-delete on user. |
| `RecordContextId__c` | Text(18) | Optional Id of the record the chat was started against (embedded widget mode) |
| `RecordContextType__c` | Text(80) | SObject name of the context record |
| `Title__c` | Text(120) | Auto-derived from first user message; truncated; editable |
| `Status__c` | Picklist (Active, Ended, Expired) | Default `Active` |
| `LastActivityAt__c` | DateTime | Updated on every turn |
| `ExpiresAt__c` | DateTime | `LastActivityAt + 24 hours`. Sweep job marks rows past this as `Expired`. |
| `Department__c` | Text(100) | Copied from agent for reporting |
| `TotalTurns__c` | Number(6,0) | Increments on every user turn |
| `TokensIn__c` | Number(10,0) | Sum across all turns |
| `TokensOut__c` | Number(10,0) | Same |
| `OwnerId` | inherits | OwnerId = chatter's user Id — drives Private sharing |

Sharing: **Private**. Standard owner-based access. Admins can see all via View All if granted.

### `ChatMessage__c`

One per message. Master-detail to `ChatSession__c` so cascade-delete + sharing inheritance.

| Field | Type | Notes |
|---|---|---|
| `Name` | Auto-number `MSG-{0000}` | |
| `ChatSession__c` | Master-detail → `ChatSession__c` | |
| `Role__c` | Picklist (User, Assistant, Tool, System) | |
| `Content__c` | LongTextArea(131072) | Plain text |
| `ToolCallsJson__c` | LongTextArea(32768) | JSON array when role=Assistant and the AI made tool calls |
| `ToolResultsJson__c` | LongTextArea(32768) | JSON array when role=Tool — server's response to those calls |
| `ModelUsed__c` | Text(60) | e.g. `gpt-4o` |
| `TokensIn__c` | Number(8,0) | |
| `TokensOut__c` | Number(8,0) | |
| `SequenceNumber__c` | Number(6,0) | Monotonic within session — used to sort because CreatedDate is only second-precision |
| `Sensitive__c` | Checkbox | Flag for filtering reports — set when content includes record data |
| `RequiredApproval__c` | Checkbox | True when role=Tool and this tool needed user approval before running |
| `ApprovedAt__c` | DateTime | When the user clicked Approve. Null if Decline. |
| `ApprovalStatus__c` | Picklist (Pending, Approved, Declined, NotRequired) | For role=Tool messages. NotRequired for reads. |

Sharing: `ControlledByParent`.

### `AgentDefinition__c.ExecuteType__c` (new field)

Picklist: `Trigger` (default), `Chat`, `Both`.

| Value | Meaning |
|---|---|
| Trigger | Only invokable from a callout (today's behavior). |
| Chat | Only listed in the Synapse Chat picker. |
| Both | Available in both modes. |

---

## Session lifecycle

```
[ user opens chat panel ]
        │
        ▼
┌─────────────────────────────────────────┐
│ Apex: startSession(agentApiName, ctx)   │
│   - find existing Active session for    │
│     (userId, agentId, ctxRecordId)      │
│   - if none → INSERT ChatSession__c     │
│     with ExpiresAt = NOW + 24h          │
│   - return session + messages           │
└─────────────────────────────────────────┘
        │
        ▼
[ user sends message ]
        │
        ▼
┌─────────────────────────────────────────┐
│ Apex: sendTurn(sessionId, text)         │
│   - check session.Status='Active'       │
│   - check ExpiresAt > NOW (else mark    │
│     Expired and throw)                  │
│   - INSERT user ChatMessage             │
│   - SELECT all messages for sessionId   │
│   - callout server /api/chat/turn       │
│     with history + new message          │
│   - INSERT assistant ChatMessage        │
│     + any tool ChatMessages             │
│   - update session: TotalTurns++,       │
│     LastActivityAt=NOW,                 │
│     ExpiresAt = NOW + 24h               │
│   - return assistant message            │
└─────────────────────────────────────────┘
        │
        ▼
[ user clicks End ]
        │
        ▼
┌─────────────────────────────────────────┐
│ Apex: endSession(sessionId)             │
│   - set Status='Ended'                  │
└─────────────────────────────────────────┘

Background sweep (scheduled Apex, every hour):
  - find ChatSession__c WHERE Status='Active' AND ExpiresAt < NOW
  - bulk update Status='Expired'
```

Session reuse rule:
- Standalone tab: same `(user, agent)` → reuse the most recent Active session
  unless user clicked "New chat" (which Ends the old one and creates new).
- Embedded widget on record page: `(user, agent, recordContextId)` is the
  uniqueness key. Different records = different sessions.

---

## Tool gating options (Annu to pick A / B / C)

When the AI calls a tool that modifies data, what happens?

### A — Read-only chat (safest)
Chat mode hard-disables write tools. The AI can only invoke read tools
(`soqlQuery`, `getObjectSchema`, `listRecentSobjectRecords`, etc.). Write tools
exist only for trigger-mode agents. No approval modal needed.

- Pro: Zero risk of bad data writes from chat.
- Pro: No new UI work.
- Con: Chat can't "update this record" use cases. Less useful for power users.

### B — Full power, no gating (riskiest)
AI runs any tool, including writes, autonomously. Same behavior as trigger mode.

- Pro: Most powerful chat.
- Con: One AI hallucination = a bad write to a real record. No human checkpoint.

### C — Full power with approval modal (recommended)
AI proposes tool calls, UI shows a confirmation dialog before any *write* tool
runs. User clicks Approve / Decline. AI sees the result and adjusts.

```
User: "Update Acme's industry to Software"
AI: calls updateSobjectRecord({sobject:'Account',id:'001...',body:{Industry:'Software'}})
   ──> server PAUSES, returns "needs approval" to Apex
   ──> Apex returns to LWC with pending approval payload
   ──> LWC shows modal: "Update Account 'Acme Corp' Industry → Software ?"
   ──> User clicks Approve
   ──> LWC calls server /api/chat/approve-tool with the call Id
   ──> Server executes the tool, conversation continues
```

- Pro: Powerful AND safe.
- Pro: Customers see and trust what the AI is doing.
- Con: ~3 extra days of build for the pause/approve protocol.

**Annu's choice (locked 2026-06-08)**: ☐ A   ☐ B   ✅ **C — full power with write approval modal**

Implications:
- Server pause/resume protocol via `/api/chat/approve-tool` is part of Phase 1.
- LWC approval modal is part of Phase 1.
- Tool catalog needs a `requiresApproval: true/false` flag per tool (defaults to true for any write tool).
- Approval audit: each `ChatMessage__c` of role=Tool records `RequiredApproval__c` and `ApprovedAt__c` so admins can report on approval activity.

---

## API surface — server `/api/chat/turn`

Single endpoint. Server is stateless.

### Request

```jsonc
POST /api/chat/turn
Authorization: Bearer <sessionKey>

{
  "agentApiName": "LeadScorer",
  "sessionId": "a0X...",          // for server logging only — SF owns sessions
  "history": [
    { "role": "user",      "content": "What's Acme's score?" },
    { "role": "assistant", "content": "I'll check.",
      "toolCallsJson": "[{\"name\":\"soqlQuery\",\"args\":{...}}]" },
    { "role": "tool",      "content": "{\"records\":[...]}" },
    { "role": "assistant", "content": "Acme scores 78." }
  ],
  "newUserMessage": "Why?",
  "context": {
    "userId":   "005...",
    "recordContextId":   "001Abc...",     // null in standalone tab mode
    "recordContextType": "Account"
  }
}
```

### Response (success)

```jsonc
{
  "assistantMessage": {
    "role": "assistant",
    "content": "Because they match three criteria: …",
    "toolCallsJson": null    // or JSON of any calls the AI made this turn
  },
  "toolMessages": [
    { "role": "tool", "content": "{\"records\":[...]}", "toolName": "soqlQuery" }
  ],
  "modelUsed": "gpt-4o",
  "tokensIn":  1247,
  "tokensOut": 380
}
```

### Response (pending approval — only if Tool Gating Option C is picked)

```jsonc
{
  "status": "needs_approval",
  "pendingToolCalls": [
    {
      "id": "tc_abc123",
      "name": "updateSobjectRecord",
      "args": { "sobject-name": "Account", "id": "001...", "body": { "Industry": "Software" } },
      "humanSummary": "Update Account \"Acme Corp\" — set Industry to Software"
    }
  ],
  "partialAssistantMessage": "I'll update Acme's industry to Software."
}
```

LWC shows the approval modal. On Approve → second call:

```
POST /api/chat/approve-tool
{ "sessionId": "...", "history": [...], "approvedCallIds": ["tc_abc123"] }
```

Server resumes orchestration from the paused tool. Same response shape.

---

## Orchestrator changes

The current orchestrator (`server/src/orchestrator/engine.ts`) takes one
agent definition + one input payload + returns one output. For chat mode we
add a new entry point:

```ts
// server/src/orchestrator/chat-engine.ts
export async function runChatTurn(args: {
  agent:           AgentDefinition;
  sessionId:       string;
  history:         ChatHistoryMessage[];
  newUserMessage:  string;
  context:         { orgId: string; userId: string; recordContextId?: string; recordContextType?: string };
}): Promise<ChatTurnResult>;
```

Under the hood:
1. Pick the agent's AI node (claude/gpt4/gemini) — the orchestrator.
2. Discover downstream catalogs (same as today via `discoverCatalogs`).
3. Build the messages array: `[system, ...history, newUserMessage]`.
4. Inject `recordContextId` / `recordContextType` into the system prompt as ambient context.
5. Run the same two-tier or flat dispatch loop already implemented in
   `openai-models.ts::runTwoTierLoop`.
6. Capture every tool call so the controller can persist them as `ChatMessage__c`
   records of role `Tool`.

History truncation (when total tokens exceed ~80% of model context):
- Always keep: system message + first user message + last 16 turns.
- Drop the middle. Phase 4 → replace with summary.

---

## Apex controller — `AgentChatController.cls`

```apex
public with sharing class AgentChatController {

    // ── 1. Picker ──────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static List<AgentSummary> listChatEnabledAgents(String filter) {
        // SELECT Id, ApiName__c, Name, Department__c, Description__c
        // FROM AgentDefinition__c
        // WHERE ExecuteType__c IN ('Chat','Both') AND Status__c = 'Active'
        //   AND (filter is blank OR Name LIKE filter OR Department__c LIKE filter)
        // WITH USER_MODE                     ← record-level access enforced
        // ORDER BY Name ASC LIMIT 200
    }

    // ── 2. Session lifecycle ──────────────────────────────────────

    @AuraEnabled
    public static SessionWithMessages startSession(
        String agentApiName,
        String recordContextId,
        String recordContextType
    ) {
        // Find existing Active session for (User, Agent, RecordContextId)
        // If found AND ExpiresAt > NOW → return it
        // If found AND ExpiresAt <= NOW → mark Expired, create new
        // Else → create new with ExpiresAt = NOW + 24h
    }

    @AuraEnabled
    public static SessionWithMessages getSession(Id sessionId) {
        // SELECT session + messages WHERE Id = :sessionId WITH USER_MODE
        // throws if expired
    }

    @AuraEnabled
    public static List<SessionSummary> listMySessions(Integer limit_) {
        // SELECT recent sessions for current user, ordered by LastActivityAt DESC
    }

    @AuraEnabled
    public static void endSession(Id sessionId) {
        // Update Status='Ended'
    }

    // ── 3. The turn ───────────────────────────────────────────────

    @AuraEnabled
    public static TurnResult sendTurn(Id sessionId, String userText) {
        // 1. Load session, verify Status='Active' and ExpiresAt > NOW
        // 2. Increment SequenceNumber, INSERT user ChatMessage__c
        // 3. Load full history (all messages for sessionId ORDER BY SequenceNumber__c)
        // 4. Build server payload: { agentApiName, sessionId, history, newUserMessage, context }
        // 5. Callout to /api/chat/turn
        // 6. INSERT assistant ChatMessage__c (+ any tool messages)
        // 7. Update session: LastActivityAt=NOW, ExpiresAt=NOW+24h, TotalTurns++, tokens
        // 8. Return the new assistant message + tool messages for the LWC to render
    }

    // ── (Optional, Tool Gating Option C) ───────────────────────────

    @AuraEnabled
    public static TurnResult approveToolCalls(Id sessionId, List<String> callIds) {
        // resumes a paused turn — sends callIds to /api/chat/approve-tool
    }
}
```

Reuses the existing `callout()` helper (server URL from `SynapseConfig__mdt`,
Bearer from `SynapseInstall__c.SessionKey__c`).

Apex callout timeout: bump to **120 seconds** for `sendTurn` — long tool
sequences are slow. If we hit the wall, switch to Phase 3 streaming.

---

## Background expiry sweep

Sessions can sit unused. We need to mark them Expired so the picker doesn't
show stale ones.

Scheduled Apex class `ChatSessionExpirer`:

```apex
global with sharing class ChatSessionExpirer implements Schedulable {
    global void execute(SchedulableContext sc) {
        List<ChatSession__c> stale = [
            SELECT Id FROM ChatSession__c
            WHERE Status__c = 'Active' AND ExpiresAt__c < :System.now()
            LIMIT 500
        ];
        for (ChatSession__c s : stale) s.Status__c = 'Expired';
        if (!stale.isEmpty()) update stale;
    }
}
```

Scheduled to run hourly via `System.schedule()`. Idempotent. Batch in groups
of 500 to stay under DML limits.

---

## LWC components

### `synapseChatPanel` (inner — used by both surfaces)

Just the conversation panel. No sidebar, no chrome.

```
┌────────────────────────────────────────────┐
│ Agent: Lead Scorer · gpt-4o   [ End chat ] │
├────────────────────────────────────────────┤
│ [user]   What's Acme's score?              │
│ [tool]   ⚙ soqlQuery → 12 records ▾        │
│ [asst]   Acme scores 78. Reason: …         │
│ [user]   Why?                              │
│ [asst]   Because three criteria matched: … │
├────────────────────────────────────────────┤
│ ┌────────────────────────────────────────┐ │
│ │ Reply…                              ↗ │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

@api properties:
- `agentApiName`
- `recordContextId` (optional)
- `recordContextType` (optional)
- `showHeader` (boolean — false when used inside sidebar)
- `onsessionchange` event when active session id changes

### `synapseChat` (standalone tab)

- Top bar: "Synapse Chat" + global search
- Left sidebar:
  - Agent picker / filter (uses `listChatEnabledAgents`)
  - Recent sessions list (uses `listMySessions`)
  - "+ New chat" button
- Right panel: `<c-synapse-chat-panel>`
- Exposes target: `lightning__Tab`

### `synapseChatWidget` (embedded)

- Floating bottom-right chat button (collapsed by default)
- Click → expands into a 360×600 panel with `<c-synapse-chat-panel>`
- `recordContextId` and `recordContextType` come from Lightning context
- Exposed targets: `lightning__RecordPage`, `lightning__AppPage`
- App-builder config:
  - `agentApiName` (admin picks which agent to embed on each layout)
  - `initialOpen` (boolean — auto-open on page load)

---

## Sharing & access

- `ChatSession__c`: **Private** sharing. OwnerId = chatter. Each user only sees their own.
- `ChatMessage__c`: Master-detail → inherits.
- Reporting: `ViewAllData` admins can build org-wide reports. Regular users see only their own conversations.

No new permission set needed — give users:
- Read on `AgentDefinition__c` (already standard for agent builder users)
- Read/Create on `ChatSession__c`
- Read/Create on `ChatMessage__c`
- Tab visibility on `Synapse_Chat`
- Apex class access to `AgentChatController`

We'll bake all of that into a new `AgentChatUser` perm set so admins can give
chat access to users without giving them agent *building* access.

---

## Implementation order (Phase 1)

| Day | Work |
|---|---|
| 1 | SF SObjects: `ChatSession__c` + `ChatMessage__c` + fields. `AgentDefinition__c.ExecuteType__c` field. Page layouts. |
| 2 | `ChatSessionExpirer` scheduled Apex + manifest entries + test. |
| 3 | Server: `/api/chat/turn` endpoint + `runChatTurn()` orchestrator wrapper. Test with curl. |
| 4 | Server: `/api/chat/approve-tool` IF tool gating option C picked. Otherwise skip. |
| 5 | Apex: `AgentChatController.cls` + test. Tied to existing `callout()` helper. |
| 6 | LWC: `synapseChatPanel` (inner panel). Just messages + input + End button. |
| 7 | LWC: `synapseChat` standalone tab wrapping the panel + sidebar + agent picker. |
| 8 | Tab metadata, perm set `AgentChatUser`, manifest, end-to-end smoke test. |

Total ~8 working days for Phase 1 if Tool Gating Option C. ~6 if Option A.

---

## Phase 2 — embedded widget on record pages

- `synapseChatWidget` LWC (~2 days)
- App-builder config (record page → agent mapping)
- Pass `recordContextId` + `recordContextType` automatically from Lightning context

## Phase 3 — streaming

- Platform Event `AgentChatChunk__e` fields: SessionId, MessageId, ChunkText, IsFinal
- Server publishes chunks as the LLM streams tokens
- LWC subscribes via `lightning/empApi` keyed by session Id
- Replaces the "waiting for response" spinner with live token rendering

## Phase 4 — polish

- Auto-titled sessions (gpt-4o-mini summarizes first user message)
- Cost cap / token quota
- Voice in / out
- Multi-modal (paste image, attach file)
- Conversation export

---

## Open risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Apex callout timeout (120s) for long tool sequences | Medium | Cap tools per turn at 8 in Phase 1. Move to Phase 3 streaming when this becomes a problem. |
| LongTextArea(131072) too small for a single chunky message | Low | Truncate at 130k with "[…]" suffix; flag the message. Almost never happens in practice. |
| SF storage hit by chatty users | Medium | 24h expiry keeps active size bounded. Add hard retention (delete expired sessions after 30 days) in Phase 4. |
| User pastes 50k chars into chat | Medium | Hard input cap at 10k client-side. Show "too long" UI. |
| Tool gating UX feels cumbersome | Medium (if Option C) | Track approval rates; Phase 4 add "trust this tool for this session" toggle |
| Per-user threads make collaboration hard | Low (per Annu's decision) | Phase 4 could add a "share thread as read-only link" feature |

---

## What this DOESN'T touch

- The Connectors page — Salesforce MCP connector keeps working as today
- The agent builder canvas — adding `ExecuteType__c` is a one-field change
- The orchestrator engine internals — chat is a new entry point, not a rewrite
- The trigger path — `/agent/execute` keeps doing what it does
- The Setup OAuth flow — same sessionKey, same Bearer

---

## Pre-flight checks before starting Phase 1

1. **Validate the current connector loop end-to-end with a real agent** —
   trigger an agent, watch it call a SF tool through the standalone MCP server,
   confirm the loop closes. We've validated Setup OAuth but not actual tool
   execution yet.
2. **Lock Tool Gating choice** (A / B / C). The doc has placeholders for all three.
3. **Confirm `ChatSession__c` Owner-based Private sharing is what customers expect** — alternative is Public Read/Write for help-desk style scenarios. Default to Private.

Once those three are clear, we're good to go on Day 1.
