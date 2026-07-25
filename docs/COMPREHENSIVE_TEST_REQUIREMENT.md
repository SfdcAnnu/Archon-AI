# Archon AI — One Comprehensive Test Requirement

Purpose: a single realistic business scenario, built once, that exercises nearly every feature in the app — so you get broad coverage in one pass instead of many disconnected test cases. Two parts:

- **Part A** — a plain-English requirement to paste into **"Describe your agent"** (AI Generation), to test that path specifically.
- **Part B** — the same scenario, but specified node-by-node so you can hand-build it deterministically (generation alone won't reliably produce a Loop/Wait/Approval combination in one shot — hand-building guarantees every node type gets touched).

Build Part B once, then use that single agent to also test Chat, Sharing, Test Runner, Deploy, and Execution Logs (Part C). Test custom MCP servers and the two other KB backends as short side-quests (Part D).

---

## The scenario: "Enterprise Deal Desk Agent"

**Business need:** When a new Lead comes in, have AI research it, decide if it's a hot enterprise-scale deal, and if so route it through a manager approval before creating follow-up work — otherwise just log it and circle back later. Notify the team either way.

This single flow naturally justifies: an AI node with tool-calling, a scored if/else branch, a durable Wait, an Approval gate, a Loop, four of the six new simple action nodes, a Call-a-Tool (Connector) node, Set Variable, and both Notes and Documents Knowledge Base content — all in one coherent, explainable graph (nothing feels bolted-on for coverage's sake).

---

## Part A — paste this into "Describe your agent"

```
When a new Lead is created, look up the Lead's company details and score how
likely it is to be a large enterprise deal (0-100) with a priority of Hot,
Warm, or Cold. If the score is above 70, this is a big deal — pause for a
sales manager to approve it before we create any follow-up work, and notify
the team either way once decided. If the score is 70 or below, wait a short
while, then just log a note on the record and create a follow-up task for
next week. Either way, post an update to Chatter on the Lead record so the
team can see what happened.
```

Expect 1-2 clarifying questions (e.g., "who should approve?", "what Slack channel/Chatter?") — answer them, generate, and compare the result against Part B below. Note where the AI's structure differs from the hand-built version and whether the difference is reasonable.

---

## Part B — hand-build node-by-node

**Object:** Lead. Create 2-3 test Leads first with varying `Company`/`AnnualRevenue`/`Industry` so you have both a "should score high" and "should score low" record to run against.

| # | Node | Type/Subtype | Config |
|---|---|---|---|
| 1 | Record Trigger | `trigger` / `record` | Object: `Lead`, Trigger on: `Create` |
| 2 | Score Lead | `ai` / `claude` | Model: your bound connection's default. Instruction: `Look up this Lead's company details using your tools, then assess how likely it is to be a large enterprise deal.` Attach a downstream **Salesforce CRM tools** catalog node with `query_records` and `describe_sobject` allowed. |
| 3 | Enterprise Check | `logic` / `if_else` | Condition: `{!ai.score} > 70` — build it with the field-insert 🔤 button, don't hand-type the token |
| 4a (Yes) | Deal Summary | `logic` / `set_variable` | Variable name: `dealSummary`, Value: `{!ai.finalText}` |
| 5a | Manager Approval | `logic` / `approval` | Approver field: `OwnerId` (or a specific manager's field), Timeout: 24h |
| 6a (Approved) | Flag as Reviewed | `action` / `update_record` | Object: `Lead`, Field mappings: `{"Rating": "Hot"}` |
| 7a | Create Follow-up | `action` / `create_task` | Subject: `Enterprise deal follow-up — {!record.Company}`, Due: `TODAY+2` |
| 8a | Notify Team | `action` / `call_tool` (Connector) | Any connected provider (Slack/Email/Gmail) — or Salesforce MCP's `post_chatter` tool if nothing else is connected |
| 6a (Rejected) | Log Rejection | `action` / `post_chatter` | Message: `Enterprise deal review declined for {!record.Company}.` |
| 4b (No) | Cooldown | `logic` / `wait` | Short wait (e.g., 2 minutes) — proves the inline (<60s) wait path |
| 5b | Log Note | `action` / `update_record` | Object: `Lead`, Field mappings referencing `{!ai.finalText}` |
| 6b | Follow-up Later | `action` / `create_task` | Subject: `Re-check {!record.Company} next week`, Due: `TODAY+7` |
| 7 (both branches converge) | Post Update | `action` / `post_chatter` | Message: `Lead {!record.Company} processed — score {!ai.score}.` |
| — | Related Contacts | `logic` / `loop` | Collection: wire a `query_records` result (Contacts at the same company, if you have any) — iterate and `create_task` per contact. This is the one node you'll wire slightly separately since it needs a real collection variable; if you don't have related Contacts handy, a loop over a static test array via Set Variable also proves the mechanism. |

**Knowledge Base:** open Knowledge Base on this agent — put a couple of sentences of real business rules in **Notes** (e.g., "A deal counts as enterprise if the company has 500+ employees or $50M+ revenue"), then add one short **Document** with a paragraph of extra context, so both paths are exercised together (they're now additive, not either/or).

---

## Part C — using this one agent to cover everything else

1. **Test Runner** — with the agent still in Draft, run it against your high-score test Lead and your low-score one. Confirm both branches complete and Execution Logs shows the right final status for each (not stuck on WAITING/WAITING_APPROVAL).
2. **Approval** — for the high-score run, check **My Approvals**, decide it, confirm the run resumes and Execution Logs updates to the real final status afterward.
3. **Deploy** — click Deploy, confirm Status flips to Active and a real Lead creation now fires it for real (not just Test Runner).
4. **Chat** — open Archon Chat, pick this agent, ask it something about a specific Lead by name; confirm it can look the record up via its Salesforce tools.
5. **Sharing** — share the agent with a second test user (or your invoker-permission-set test user), confirm they can chat with it but not edit it.
6. **Execution Logs** — filter by each status (Success/Error/Waiting/Waiting Approval), open a row's detail panel and confirm Output payload is populated, and export CSV.

## Part D — side quests

- **Custom MCP server**: add one from Connectors → Add custom MCP server (any test MCP URL you have, even a simple local one), confirm it appears as a connector option on a Call-a-Tool node.
- **KB backends**: repeat the Documents upload on a second test agent using "Your own Postgres" and a third using "Your Salesforce org" backends, confirming retrieval works on all three (Notes' additive behavior only needs verifying once).
- **AI Provider Setup**: from Archon Setup → AI Provider Setup, add a second connection for a different engine (e.g., OpenAI if you started with Claude), mark it Preferred, and confirm a new AI node picks it up.
