# Archon AI — End-to-End Test Plan

Purpose: a sequential, dependency-ordered walk through every feature of Archon, with concrete test data, so you can go start-to-end and record Pass/Fail + feedback per item. Later sections depend on earlier ones working — if something in an early section fails, fix or note it before relying on it in a later section.

How to use this doc: work top to bottom. For each test case, fill in **Result** (Pass/Fail) and **Notes** as you go. Anything you flag as Fail or "needs discussion," we review together afterward and decide what to do about it — don't stop to fix things mid-run unless a failure blocks a later section.

Companion docs: [CONFIGURATION_GUIDE.md](./CONFIGURATION_GUIDE.md) for one-time setup, [USER_GUIDE.md](./USER_GUIDE.md) for what each feature is supposed to do.

Legend: **Result:** ☐ Pass ☐ Fail — **Notes:** _______________________________

> **Updated 2026-07-24 — round 1 of feedback is fixed.** Bugs found while reviewing round-1 results (TC-700 log status not updating after a Wait/Approval resumes, TC-701 CSV export unimplemented, Test Runner blocked on Draft, if/else variable insertion, TC-120's real cause, connector auth, action nodes unreachable, KB upload chicken-and-egg, permission set sprawl, missing AI Provider Setup page, no custom MCP server support, shared .env key fallback) are all fixed and deployed — see [USER_GUIDE.md](./USER_GUIDE.md)'s update note for the full list. Re-run any test case you already marked Fail for one of those reasons; everything else in this plan is unchanged. A new combined test requirement covering every feature end-to-end is available on request for a single, minimal-round-trips pass.

---

## Phase 0 — Setup verification

Confirms Configuration Guide steps actually took effect before testing anything built on top of them.

### TC-001 — Server reachable
- **Steps:** Open **Archon Setup** tab. Check connection status.
- **Expected:** Status shows **Connected**, with a "configured by / at" line naming your user and a recent-ish timestamp.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-002 — Salesforce MCP auto-connects
- **Steps:** Open Builder → any agent (or create a scratch one) → **Connectors**.
- **Expected:** The **Salesforce MCP** tile already shows **Connected** with no separate action taken (it rides on TC-001's org authorization).
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-003 — Permission sets assigned correctly
- **Steps:** As a builder-role test user, confirm you can open Agent Home and see **New Agent**. As a chat-only test user (if you have one), confirm they can open Synapse Chat but the Builder actions are unavailable to them.
- **Expected:** Access matches the permission-set table in the Configuration Guide.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

---

## Phase 1 — Connectors (external providers)

### TC-010 — Connect Gmail
- **Test data:** any Gmail test account you're willing to authorize.
- **Steps:** Connectors directory → Gmail tile → Connect → complete OAuth consent.
- **Expected:** Tile flips to Connected, shows the connected account's email.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-011 — Connect Slack (or Outlook / Teams — pick at least one messaging + one email provider you actually use)
- **Steps:** Same pattern as TC-010 for the provider(s) you plan to test downstream in Phase 4.
- **Expected:** Tile flips to Connected.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-012 — Disconnect / reconnect
- **Steps:** Disconnect a connected provider, confirm its tile reverts to "Connect," then reconnect.
- **Expected:** Clean state transition both ways; no orphaned connector reference left on any node using it (node should show "not connected" state, not silently keep working).
- **Result:** ☐ Pass ☐ Fail — **Notes:**

---

## Phase 2 — AI Engine Connections

### TC-020 — Add a personal Claude key
- **Test data:** Engine = `Claude (Anthropic)`, a valid Anthropic API key, Ownership = `Personal`, Active = on, Preferred = on.
- **Steps:** Add via the AI Engine Connection form.
- **Expected:** Saves; shows as your Preferred Active Claude connection.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-021 — Add an org-wide Shared key (admin only)
- **Test data:** Engine = `Claude (Anthropic)`, Ownership = `Shared`, "Grant read access to all users in this org" = on.
- **Steps:** As the `ArchonAiEngineAdmin` user, add a Shared connection.
- **Expected:** Saves; a second test user with no personal key of their own can still run a Claude AI node successfully (proves the fallback in Configuration Guide §8 step 4).
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-022 — Resolution order proof
- **Steps:** With both TC-020 (your personal key) and TC-021 (shared key) present, run any agent's Claude AI node as yourself.
- **Expected:** Your personal key is used, not the shared one (check Execution Logs / server logs if you need to confirm which key fired — e.g. temporarily use an invalid personal key and confirm the run fails rather than silently falling through to Shared).
- **Result:** ☐ Pass ☐ Fail — **Notes:**

---

## Phase 3 — Manual agent building: basics

### TC-030 — Create, save, reload
- **Steps:** Agent Home → New Agent → drag-and-drop → give it a name ("Test Agent 01") → drag one `record` trigger node onto the canvas, configure `objectType = Lead`, `triggerOn = Create` → Save → navigate away → reopen the agent.
- **Expected:** Agent saves as **Draft**; reopening shows the exact same node/config/position.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-031 — Wire two nodes
- **Steps:** Add a `post_chatter` action node with `message = Test run from {!record.Name}`. Drag a connection from the trigger's `out` port to the action's input port. Save.
- **Expected:** Connection persists after reload (visually redrawn correctly).
- **Result:** ☐ Pass ☐ Fail — **Notes:**

---

## Phase 4 — Node-by-node testing

For each node below: build a minimal single-purpose test agent (trigger → the node under test → an `end` node), Save, then use **Test Runner** with a real record Id of the right object, and confirm via **Execution Logs** afterward. Keep Status = Draft during this phase (Test Runner works on Draft agents).

### 4.1 Trigger nodes

**TC-100 — record trigger**
- **Test data:** `objectType = Lead`, `triggerOn = Create`. Test Runner record Id: any existing Lead Id.
- **Expected:** Run starts; downstream node receives `{!record.*}` tokens resolved from that Lead.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-101 — schedule trigger**
- **Test data:** `cronExpression = 0 * * * * ?` (fires every minute — for testing only, revert after).
- **Expected:** Agent fires on its own once Active, without a Test Runner click (verify via Execution Logs, not Test Runner — schedule triggers aren't meant to be driven by Test Runner).
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### 4.2 AI nodes

**TC-110 — Claude AI node**
- **Test data:** `instruction = Summarize this lead's Company and Industry in one sentence.`, model `claude-sonnet-4-6`, `useKnowledgeBase = off`.
- **Expected:** Execution Log shows a completed AI step with a coherent one-sentence summary output.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-111 — GPT-4 AI node**
- **Test data:** same instruction, model `gpt-4o`. Requires an OpenAI AI Engine Connection (personal or shared) — add one first if missing.
- **Expected:** Same as TC-110, different model.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-112 — Gemini AI node**
- **Test data:** same instruction, model `gemini-2.5-flash`. Requires a Gemini AI Engine Connection.
- **Expected:** Same as TC-110.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-113 — AI node with a catalog attached (tool-calling)**
- **Test data:** wire a `salesforce_crm_tools` catalog node to the AI node, `allowedTools = [get_record, query_records]`, connector = your connected Salesforce MCP. `instruction = Look up this Lead's Email field and tell me the domain.`
- **Expected:** Execution Log shows the AI actually invoking `get_record` (or `query_records`) as a tool call, not just answering from the trigger payload alone.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### 4.3 Logic nodes

**TC-120 — if_else, true branch**
- **Test data:** `condition = {!record.AnnualRevenue} > 100000`. Test Runner record: a Lead with AnnualRevenue set above 100000.
- **Expected:** Run proceeds down the `yes` branch (wire a distinguishable `post_chatter` on each branch to tell them apart in the log, e.g. "HIGH REVENUE" vs "LOW REVENUE").
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-121 — if_else, false branch**
- **Test data:** same agent, a Lead with AnnualRevenue below 100000 (or blank).
- **Expected:** Run proceeds down the `no` branch.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-122 — set_variable + downstream reference**
- **Test data:** `variableName = leadSummary`, `template = Company: {!record.Company}`. Downstream `post_chatter` node: `message = {!leadSummary.value}`.
- **Expected:** Chatter post contains the resolved "Company: <actual value>" text. Confirm the Variables tab on the downstream node lists `leadSummary` as a click-to-insert token.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-123 — wait, short (inline)**
- **Test data:** `delayValue = 30`, `delayUnit = seconds`.
- **Expected:** Run completes inline in the same Test Runner call, ~30s elapsed time shown.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-124 — wait, durable (long)**
- **Test data:** `delayValue = 2`, `delayUnit = minutes`.
- **Expected:** Test Runner returns/shows a **WAITING** status immediately (doesn't block the UI for 2 minutes). Checking Execution Logs ~2-3 minutes later shows the run auto-resumed and completed, driven by the background poller, with no manual action taken.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-125 — approval, approved path**
- **Test data:** `approverField = OwnerId`, `timeoutHours = 24`. Use a Lead you own as the test record.
- **Expected:** Run pauses at **WAITING_APPROVAL**; an `AgentApproval__c` appears under **My Approvals** for you (the owner). Click **Approve** (optionally add a comment) — run resumes down the `approved` branch.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-126 — approval, rejected path**
- **Test data:** same setup, different test record.
- **Steps:** Click **Reject** instead.
- **Expected:** Run resumes down the `rejected` branch.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-127 — approval, timeout path**
- **Test data:** `timeoutHours` set as low as the UI allows (or use a short wait as a stand-in if hours can't go below 1) — the goal is to observe an un-actioned approval age out.
- **Expected:** After the timeout window, the run auto-resolves (rejected/timed-out) without anyone clicking Approve/Reject.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-128 — loop over a list**
- **Test data:** upstream `query_records` node: `SELECT Id, Name FROM Contact WHERE AccountId = '{!record.Id}' LIMIT 5` (use a Lead/Account with at least 2-3 related Contacts, or swap to any object relationship you have real data for). Loop: `collectionVar = {!records}` (bound to the query node's output), `iteratorVar = item`, `maxIterations = 10`. Loop body: single `post_chatter` node, `message = Contact: {!item.Name}`.
- **Expected:** One Chatter post per item in the list, then the run proceeds out the `done` port.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-129 — loop guard: nested disallowed node**
- **Steps:** Try to place a `wait` or `approval` node inside a loop body.
- **Expected:** Either the Builder prevents it, or if it saves, running it produces a clear validation/engine error rather than a silent hang or corrupted run — record whichever behavior you see.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### 4.4 Action nodes

**TC-140 — get_record**
- **Test data:** `objectType = Lead`, `fields = Id,Name,Email,Company`.
- **Expected:** Fields available downstream as tokens; check via a follow-up `post_chatter` referencing one.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-141 — update_record**
- **Test data:** `objectType = Lead`, `fieldMappings = {"Description": "Touched by Archon test TC-141"}`.
- **Expected:** The target Lead's Description field is actually updated — verify on the record itself, not just the log.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-142 — create_record**
- **Test data:** `objectType = Task`, `fieldMappings = {"Subject": "Archon TC-142 test task", "WhoId": "{!record.Id}"}` (adjust `WhoId`/`WhatId` to whatever your test record type needs).
- **Expected:** A new Task record actually exists in Salesforce after the run.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-143 — query_records**
- **Test data:** `soql = SELECT Id, Name FROM Lead WHERE Id = '{!recordId}'`.
- **Expected:** Returns exactly the triggering record; output usable downstream (e.g. in a Loop, per TC-128).
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-144 — create_task**
- **Test data:** `subject = Follow up — Archon TC-144`, `dueDate = TODAY+1`, `priority = High`.
- **Expected:** Task created with correct due date and priority.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-145 — post_chatter**
- **Test data:** `message = TC-145 test post — {!record.Name}`.
- **Expected:** Chatter post visible on the target record's feed with the resolved name.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-146 — apex_action (if you have a test Invocable class available)**
- **Test data:** point at any existing Invocable Apex class/method in your org.
- **Expected:** Invocable fires with the mapped inputs; skip this case with a note if you don't have a suitable test class handy.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### 4.5 Call a Tool

**TC-150 — Call a Tool, standard (Salesforce MCP)**
- **Steps:** Provider = Salesforce MCP → Standard tool → pick `query_records` (or similar) from the live-fetched list → fill the schema-generated parameter form.
- **Expected:** Tool list loads live (not hardcoded); parameter form matches the tool's real schema; run executes and returns real data.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-151 — Call a Tool, custom (Apex/Flow)**
- **Steps:** Provider = Salesforce MCP → Custom → pick any Apex Invocable action or Flow exposed in your org.
- **Expected:** Parameter form matches that action's real input schema; run executes it.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-152 — Call a Tool, a connected non-Salesforce provider**
- **Test data:** whichever provider you connected in TC-010/011 (e.g. Gmail → `send_email` or similar).
- **Expected:** Same live-schema behavior as TC-150, against that provider.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### 4.6 Catalog nodes (branch-scoping)

**TC-160 — catalog scoped to one branch only**
- **Steps:** Build: trigger → `if_else` → on the **yes** branch only, AI node with a `salesforce_crm_tools` catalog attached; on the **no** branch, a plain AI node with no catalog. Run once down each branch.
- **Expected:** The AI on the `yes` branch can make tool calls; the AI on the `no` branch cannot (no tools available to it) — proves catalogs are scoped per-branch, not global to the whole agent.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

**TC-161 — allowedTools restriction actually restricts**
- **Test data:** `allowedTools = [get_record]` only (no query/create/update).
- **Steps:** Give the AI an instruction that would naturally want a write (e.g. "update this Lead's Description").
- **Expected:** The AI either can't perform the write (tool not offered) or the run/log shows it attempted and was denied — not a silent unrestricted write. Note: this restriction is a hard enforcement on the OpenAI (gpt4) adapter; on the Claude adapter it's currently a soft system-prompt instruction only — test both and record the difference if you test both providers here.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

---

## Phase 5 — Knowledge Base

### TC-200 — Notes, always-included behavior
- **Test data:** Notes = `Any lead from the "Acme" company must always be marked High priority.`
- **Steps:** AI node with `useKnowledgeBase = on`, instruction referencing priority. Run against a Lead with Company = "Acme".
- **Expected:** The AI's output reflects the note's rule even though it wasn't repeated in the instruction.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-201 — Documents, Archon default backend
- **Steps:** Documents tab → confirm backend = "Archon default (hosted for you)" → add a document, e.g. title "Refund Policy", text: "Refunds are approved for purchases under 30 days old. Purchases over 30 days require manager approval." → wait for indexing status to complete.
- **Expected:** Document shows Indexed status with a chunk count > 0.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-202 — Documents retrieval proof (Archon default)
- **Steps:** AI node, `useKnowledgeBase = on`, `instruction = A customer wants a refund for a 45-day-old purchase — what's our policy?`. Run.
- **Expected:** Answer correctly reflects the manager-approval rule from TC-201's document — proves retrieval-by-relevance is actually happening, not just Notes.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-210 — Documents, external Postgres backend
- **Test data:** a real Postgres connection string with the `pgvector` extension available.
- **Steps:** Documents tab → select "Your own Postgres" → paste connection string → **Test connection** → Save storage backend → add the same refund-policy document as TC-201.
- **Expected:** Test connection succeeds before save; document indexes successfully; querying the external DB directly shows the content/vectors actually landed there (not in Archon's own DB).
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-211 — Documents retrieval proof (external Postgres)
- **Steps:** repeat TC-202 against this agent.
- **Expected:** Same correct retrieval behavior, sourced from the external DB.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-220 — Documents, Salesforce-native backend
- **Steps:** Documents tab → select "Your Salesforce org" → add the same refund-policy document.
- **Expected:** A corresponding `AgentKbChunk__c` record (or records) actually exists in Salesforce afterward. If this is a brand-new object with no prior records, allow a few minutes for SOSL search indexing before the next test — a `"does not support search"` error in that window is expected, not a failure.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-221 — Documents retrieval proof (Salesforce-native, keyword-based)
- **Steps:** repeat TC-202 against this agent.
- **Expected:** Correct-ish retrieval, but recognize this path is keyword (SOSL) matching, not semantic vector similarity — phrase your test question using words that actually appear in the document text, unlike TC-202/211 which can paraphrase freely.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

---

## Phase 6 — AI Agent Generation

### TC-300 — Direct generation (no clarifying questions needed)
- **Test data (paste as the requirement):**
  > When a new Lead comes in, summarize the Company and Industry fields, then post that summary as a Chatter note on the record.
- **Expected:** Generates a complete, saveable agent in one round — `record` trigger → AI (claude) node → `post_chatter` node, wired correctly, no clarifying-question round needed. Lands as Draft on the canvas.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-301 — Generation with clarifying questions
- **Test data:**
  > Notify the right people when a big deal closes and make sure someone signs off on it first.
- **Expected:** This is deliberately underspecified (no threshold for "big," no named notification channel, no named approver) — expect 1-2 clarifying questions back. Answer them (e.g. "Amount > 50000", "Slack #sales", "the Opportunity owner's manager") and click Continue.
- **Expected after answering:** A complete agent generates using your answers, including an `approval` node and a checklist noting anything still unresolved (e.g. "Slack not yet connected").
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-302 — Generation with an attached requirements document
- **Test data:** a short `.txt` file, e.g.:
  ```
  Expense Policy Q&A Agent

  When someone asks a question about our expense policy, answer using
  the attached policy knowledge base. If the question involves an amount
  over $500, create a Case for Finance to review instead of answering directly.
  ```
- **Steps:** Attach the file instead of (or alongside) typed text, Generate.
- **Expected:** Agent reflects the document's content correctly (an if_else on amount, a Case-creation branch, an AI answer branch with `useKnowledgeBase` likely on).
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-303 — Checklist auto-verification
- **Steps:** Take an agent generated with an unconnected provider referenced in its checklist (e.g. Slack, if not connected yet). Note the checklist item's state, then go connect that provider for real, return to the agent.
- **Expected:** The checklist item flips to done/verified automatically — it's reading live connector status, not a one-time snapshot.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-304 — Generated agent is editable like any other
- **Steps:** Take any agent from TC-300/301/302, manually add or rewire one node on the canvas, Save.
- **Expected:** Behaves identically to editing a hand-built agent — no separate/parallel save path, no broken state.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-305 — Malformed/impossible request still produces something usable
- **Test data:**
  > Post an update to our internal system called "FooBarTracker" whenever a Lead converts.
  (a provider Archon doesn't actually support)
- **Expected:** Still returns a valid, saveable agent rather than a hard error, with the unsupported part explicitly called out in the checklist.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-306 — Cold-start resilience
- **Steps:** If the server has been idle a while (first generation of the day, or wait ~20 min after last use), trigger a generation.
- **Expected:** Modal shows a "waking up" message and retries quietly rather than showing a raw HTML error; completes successfully once the server is up.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

---

## Phase 7 — Going live

### TC-400 — Draft agents don't run automatically
- **Steps:** With TC-300's agent still Draft, create a real Lead that matches its trigger criteria.
- **Expected:** Nothing happens — no Chatter post, no execution log entry. Confirms the Draft safety gate.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-401 — Activating an agent makes it fire for real
- **Steps:** Flip TC-300's agent to **Active**. Create another matching Lead.
- **Expected:** The agent fires on its own via the real trigger path (not Test Runner) — Chatter post appears, Execution Log shows a new entry with a real trigger source.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

---

## Phase 8 — Chat

### TC-500 — Start a chat session
- **Steps:** Synapse Chat tab → pick an Active agent from the picker → send a message referencing something the agent can act on.
- **Expected:** Multi-turn conversation works; response reflects the agent's configured AI/tools/KB.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-501 — Embedded chat panel on a record page
- **Steps:** If `synapseChatPanel` is placed on a record page layout, open that record and use the panel with record context passed in.
- **Expected:** Chat correctly references the current record's fields when relevant.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-502 — Session end / expiry
- **Steps:** Click **End** on an active session.
- **Expected:** Session closes cleanly; starting a new chat with the same agent begins a fresh session, not a resumed one.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

---

## Phase 9 — Sharing & access

### TC-600 — Share an agent with another user
- **Steps:** Share modal on an agent → add a second test user (who wouldn't otherwise have access under org-wide-private) → have that user attempt to open it.
- **Expected:** They can now see/open it; before sharing, they couldn't.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-601 — Remove sharing
- **Steps:** Remove that user from "Currently shared with."
- **Expected:** They lose access again.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

---

## Phase 10 — Execution Logs

### TC-700 — Log completeness
- **Steps:** After running several test cases above, open Execution Logs for one of the busier test agents.
- **Expected:** Every run appears with correct status (SUCCESS/ERROR/WAITING/WAITING_APPROVAL/TIMEOUT as appropriate), timing, and — for AI steps with `captureReasoning` on — visible reasoning/tools-used detail.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

### TC-701 — CSV export
- **Steps:** Export CSV.
- **Expected:** Downloaded file contains the visible log rows in a usable format.
- **Result:** ☐ Pass ☐ Fail — **Notes:**

---

## Summary sheet (fill in after finishing all phases)

| Phase | Total cases | Passed | Failed | Skipped |
|---|---|---|---|---|
| 0 — Setup | 3 | | | |
| 1 — Connectors | 3 | | | |
| 2 — AI Engine Connections | 3 | | | |
| 3 — Manual building basics | 2 | | | |
| 4 — Node-by-node | 25 | | | |
| 5 — Knowledge Base | 8 | | | |
| 6 — AI Generation | 7 | | | |
| 7 — Going live | 2 | | | |
| 8 — Chat | 3 | | | |
| 9 — Sharing | 2 | | | |
| 10 — Execution Logs | 2 | | | |
| **Total** | **60** | | | |

**Top issues to discuss:** (list the Fail'd/flagged case IDs here once you're through, and we'll triage together)
