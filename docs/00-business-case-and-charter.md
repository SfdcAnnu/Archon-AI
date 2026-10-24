# Archon — Business Case and Project Charter

| | |
|---|---|
| Document | 00 · Business case and project charter |
| Product | Archon, by Aeventra AI |
| Version | 0.1, draft for the sponsor |
| Date | 24 October 2026 |
| Owner | Annu (sponsor and product owner) |
| Status | Draft. Lines marked **[sponsor]** need a number or a decision only the sponsor can give. |

This is the first document in the set. Everything after it (solution architecture, product requirements, data dictionary, test strategy, runbook) traces back to the problem, the goals and the scope written here.

## 1. Summary

Archon is a platform that turns a plain-language request into an AI assistant that works inside Salesforce. An admin describes the assistant; Archon builds it as a visible flow on a canvas, connects it to the systems the team already uses, and runs it: chatting with customers on WhatsApp or the web, answering the team by voice or in the copilot, or working in the background on records. People stay in charge: data stays in Salesforce, assistants follow the person's permissions, important actions wait for approval, every conversation is on record, and a customer can always be handed to a person.

The product exists and runs today in a development org with six agents, a managed-package source tree, a hosted server and a set of connector servers. This charter puts the business reasons, the scope and the decisions in writing so the next release is planned rather than discovered.

## 2. The problem

Salesforce customers want AI assistants that act on their data: qualify a WhatsApp lead, revive a lost deal, review deal risk, change a setup field by asking. Today they have three poor options.

- **Hand-built integrations.** A developer wires a model to the org by hand. Slow, fragile, and every agent is a project.
- **The platform vendor's own agents.** Capable, but priced per conversation and per user, tied to one model family, and heavy for a team that wants one assistant on one process.
- **Generic chatbots.** Cheap, but they do not know the org, cannot act on records safely, and leave no audit trail.

What is missing is a way for an admin, not a developer, to describe an assistant and get one that is safe to run inside the org, with the controls a Salesforce customer expects.

## 3. The product

**Six products on one platform**, as the website names them: Agent Builder (describe it, Archon builds it), Customer Chat (WhatsApp and web), Voice (talk to Archon, watch it work), Team Copilot (ask the business a question), Metadata Expert (change Salesforce setup by asking), Connections (the tools the team already uses).

**Two kinds of agent.** Communication agents chat with people, by text or by voice in the browser. Automation agents work in the background on records, as steps with AI judgement where needed and rules everywhere else. An agent can be set to do both.

**Five principles, all built in today.** Your data stays in Salesforce. Assistants follow your permissions: an agent runs as the person, a team or the org by policy. Important actions need approval, in the chat where the person is. Every conversation is on record. A person can take over any conversation and give it back.

## 4. Who it is for

| Who | What they need | Where they meet Archon |
|---|---|---|
| Salesforce admin or builder | Build and change assistants without code; see what they do; control what they may touch | Agent Builder canvas, Setup checklist, Connectors, AI Models |
| Sales and support people | Answers from Salesforce in plain words; leads qualified and deals revived while they sleep; a way to step in when a customer asks for a person | Team Copilot, Conversations, the handoff |
| Customers of the org | A reply in seconds on the channel they use, that knows them and never makes promises it cannot keep | WhatsApp and web chat |
| IT and security | Permissions respected, keys and tokens held properly, every action traceable | Identity policy, approvals, Runs and Conversations |

**First market.** Salesforce orgs that already run WhatsApp and SMS through 360 SMS App, which gives a channel, a customer base and a reason to buy on day one. **[sponsor]** confirm the first market and the first ten target accounts.

## 5. Goals and how they are measured

| Goal | Measure | Today |
|---|---|---|
| An admin builds a working assistant from a description | Build time and cost per build | About 5 minutes and under $0.50 per Architect build, with a review and repair round, measured September 2026 |
| Replies feel instant | Warm chat reply time | About 2 to 4 seconds warm; a write turn drops from 3.7 to about 1.8 seconds with Background tools on a model that sends text and tool calls together |
| Assistants do what they were asked | Share of conversation checks passed in the test harness | 98 percent on the communication-agent round of 1 October 2026 |
| Nothing happens without control | Writes gated by approval where configured; every conversation and run on record | In place |
| Customers get a person when they ask | Handoff to a person, with return | Built 12 October 2026, not yet exercised with a live customer |
| The business grows | Paying orgs, monthly recurring revenue, demo-to-trial conversion | **[sponsor]** targets for the first two quarters |

## 6. Scope

**Built and running today**

- Agent Builder: canvas, palette, Architect that designs, reviews and repairs; prebuilt Salesforce actions; MCP, Apex and Flow tools; AI steps with typed outputs; if/else, loops, expressions.
- Channels: WhatsApp through 360 SMS App, web chat, the record-page widget, the full-screen Archon copilot with voice.
- Connections: Salesforce, Gmail, Google Drive, custom MCP servers; accounts per person, per team or per org, chosen on the node.
- Controls: approvals in chat and on records, AI keys bound per agent, identity policy, guardrails on usage, the handoff to a person, Background tools.
- Operations: Runs, Conversations, Cost, Setup, a managed-package source tree with namespace `archon`.

**The next release** (agreed order): field verification after the survey; one graded build of a complex automation; the connector pack (enrichment, document generation, registered HTTP endpoints, document reader, Slack and Teams, calendar); the n8n gaps (pinned data and a per-step execution view, retry and on-error, Switch, Merge, Code); the JWT package design; Stop generating.

**Out of scope for now.** Voice agents on telephone calls (the website says it; it is not built and must be confirmed or removed before launch). A mobile app. Any model-training feature.

## 7. Where things stand

- Code: the Salesforce project (Apex, objects, the React app), the Node server, the Salesforce CRM and Metadata MCP servers, the marketing site. Each in its own repository, with main, Release, Dev and Pre-Release branches; the server deploys from Release.
- Environments: one development org with six agents (Archon Copilot, Metadata Expert, Salesforce Employee Agent, Opportunity Revival, WhatsApp Lead Intake Qualifier, Deal Risk Review in draft); the server on Render's free tier; Postgres on Render.
- Tests: 395 server tests, Apex tests on the new modules, a communication-agent harness that drives real conversations and scores them.
- Documents: this is the first. The architecture, requirements, data dictionary, test strategy and runbook follow in that order.

## 8. Costs and pricing

| Item | Today | Planned | |
|---|---|---|---|
| Hosting | Render free tier, sleeps when idle | Always-on AWS: container, managed Postgres, secret store | **[sponsor]** monthly budget |
| Model spend | Measured per build and per turn; paid on the customer's own keys, bound per agent | Same; the platform never pays for a customer's turns | |
| Third-party | 360 SMS App for WhatsApp; Google and Microsoft apps for mail and calendar | Apollo for enrichment, a document renderer | **[sponsor]** which are passed through at cost |
| People | **[sponsor]** | | |
| Pricing | Website names three plans: a team trying its first assistant, a team running assistants every day, an enterprise | **[sponsor]** the numbers and what each plan includes | |

## 9. Risks and what we do about them

| Risk | What it would cost | Mitigation |
|---|---|---|
| Cold starts on free hosting make the product look hung and kill builds mid-survey | Lost demos, failed builds | The AWS move; until then the Setup button wakes the server and nothing retries silently |
| A model ignores instructions (gpt-4.1 ignored save rules over four prompt rounds) | Wrong replies to customers | Rules moved into data and tool contracts, not prompts; stronger models for customer-facing agents |
| Keys and tokens | A leak is a breach across customers | Keys sealed in the server, bound per agent, no fallback; the JWT private key goes to a secret store on AWS |
| Salesforce AppExchange security review for the managed package | Months of delay if failed | Design for it now: no hard-coded credentials, sharing respected, every REST surface authenticated |
| Dependence on 360 SMS App for WhatsApp | Channel outage or policy change | The bridge is one Apex class; a second provider is a second bridge |
| One person holds the whole product | Everything stops if they do | This document set, the tests, and the memory of decisions in the repositories |

## 10. Decisions the sponsor owns

1. First market and first ten accounts.
2. Pricing numbers and what each plan includes.
3. Hosting budget and the date of the AWS move.
4. Microsoft: Microsoft's own Work IQ servers (a Copilot licence per user) or a self-hosted Graph server.
5. JWT in the package: one packaged app with one key, or bring-your-own-key per customer as well.
6. Whether the n8n nodes are canvas-only or also known to the Architect.
7. Whether Stop generating is final or resumable.
8. The claims on the website to confirm or remove before launch: phone calls, same-day go-live, the plan names.

## 11. How the work runs

- One item at a time, in the agreed order; each item is explained, mocked where it has a screen, approved, built, verified in the real org, committed and pushed before the next starts.
- Every change is committed on main and merged to Release, Dev and Pre-Release; the server's Release branch is what runs.
- Definition of done: type checks and tests pass, deployed to the org, verified in a browser or a real run, committed, and the decision recorded.
- Live model runs are kept to one verification per change, because they spend the sponsor's money.

## 12. Next documents

| # | Document | Answers | Effort |
|---|---|---|---|
| 01 | Solution architecture | What the pieces are and how a turn, a run, a sign-in, an approval, a handoff and a background write move through them | 2 to 3 days |
| 02 | Product requirements, next release | What exactly ships, for whom, with acceptance criteria | 1 day |
| 03 | Data dictionary | Every object and field, who writes and reads it | Half a day |
| 04 | Test strategy | What is tested where, and the trace from feature to test | Half a day |
| 05 | Deployment and operations runbook | How to release, roll back, watch and recover | Half a day |
