# Archon — Product Strategy and Simplification Plan

| | |
|---|---|
| Document | 06 · Product strategy and simplification plan |
| Product | Archon, by Aeventra AI |
| Version | 0.1, draft for the sponsor's decision |
| Date | 21 November 2026 |
| Owner | Annu (sponsor and product owner) |
| Audience | The sponsor, and the engineers who will build the next two months |
| Traces to | [00 · Charter](00-business-case-and-charter.md) sections 4 and 5; [02 · Requirements](02-product-requirements-next-release.md), whose order this document changes |
| Sources | Demo feedback from prospective customers in November 2026; measurements from the WhatsApp intake agent's last twelve conversations in the development org on 21 November 2026; two market summaries the sponsor gathered (demand by agent type, platform capabilities buyers expect) |

This document answers one question: what does Archon have to be so that a Salesforce customer chooses it over a personal Claude subscription, over n8n, and over Agentforce. It records what the demos told us, what the numbers say, the positioning that follows, and a plan in three tracks with measured targets. Document 02's release order is re-sequenced by section 8.

## 1. What the demos told us

Five things, from several prospects, consistently.

1. **The UI is a builder's console, not an enterprise product.** Connections, identity policies and the chat screens looked complex. Creating an agent should be simple, with little manual work.
2. **"How is this different from Claude, or from n8n?"** Every prospect asked.
3. **Replies took 8 to 10 seconds.**
4. **Voice agents are in demand.** Chat first is fine, but voice should be visible as coming.
5. **It uses too many tokens, and the agent needed too much prompt to behave.**
6. **For reading sales data** (deal summaries, deal health), an employee can use a Claude subscription with the Salesforce connector and pay no API tokens. Why would they use our agent?

Point 6 is right and changes the pitch (section 3). Points 1 and 4 are right and change the product (section 5, tracks B and C). Points 3 and 5 are partly perception and partly real, and the measurements below separate the two.

## 2. What the numbers say

The WhatsApp intake agent, twelve most recent conversations, gpt-4.1, measured from `PhaseMsJson__c` and the token fields on each turn.

| Measure | Measured | Reading |
|---|---|---|
| Input tokens per turn | 4,976 average, 4,108 on turn one | The fixed prefix (instructions, tool definitions, record block) is about 4k; a whole conversation's history adds only about 1k |
| Output tokens per turn | 64 | Replies are short, as they should be on WhatsApp |
| Tokens per 7-turn conversation | 52k to 56k in, about 700 out, 40 percent served from the prompt cache | About **9 cents** per conversation at gpt-4.1 prices. Agentforce lists about 2 dollars per conversation |
| Model loop per turn | 2.6 s | Two model calls on a write turn, one on a talk turn |
| Server turn, warm | 4.1 s | Of which tool loading 1.0 s, identity 0.3 s, prompt 0.1 s, model 2.6 s |
| Apex side per turn | about 1.5 s | Callout round trip plus writing the transcript before the reply is sent |
| End to end to WhatsApp, warm | about 5.5 s | Too slow, and not what the demo saw |
| Turns with a sleeping connector | 8.0 to 8.7 s, three turns on 21 Nov | The CRM connector on Render's free tier was asleep: 6 s of retries per turn until it woke |
| Describe calls | 5 in 67 turns, 1,500 characters each | Each one is a whole extra model round trip, and the record block already carries the picklist values |

Two conclusions. The 8 to 10 seconds the prospects saw was a sleeping free-tier host and a cold first turn, which hosting fixes without code; the steady state of 5.5 seconds is still too slow and needs the runtime work in track A. The token complaint is half perception, because the Cost page shows tokens and not the 9 cents, and half real, because a 2 to 3 times reduction is available without changing what the agent does.

## 3. Where Archon wins, and where it does not

| Alternative | What it does well | What it cannot do, and Archon can |
|---|---|---|
| A personal Claude subscription with the Salesforce connector | An employee asking about their own records, interactively, on their own login, for a flat monthly fee | Talk to a customer on WhatsApp at any hour with a persona, guardrails and a transcript in Salesforce; run unattended on a record trigger or a schedule; be built once by an admin for two hundred people; enforce approvals, allowed tools and identity per node; hand off to a person and come back; satisfy IT, which will not let two hundred personal accounts hold CRM tokens |
| n8n and similar workflow tools | A thousand connectors, a good execution view, cheap self-hosting, code nodes | Live inside Salesforce with its sharing model, be installed as a package, keep conversations as CRM records, approvals in the CRM, a WhatsApp channel through 360 SMS, an Architect that builds from a sentence |
| Agentforce | Distribution, trust, the vendor's own models | Any model on the customer's own key; a tenth of the price per conversation; the WhatsApp channel the 360 SMS customers already run; a builder an admin can use in minutes |

The employee assistant that summarises deals is Archon's weakest demo, because the first alternative does it well. It leaves the pitch. What stays is what none of the three do: customer-facing agents on WhatsApp and the web, and background agents on records, governed in Salesforce, on any model.

## 4. Positioning

**Archon builds customer-facing and background AI agents for Salesforce. WhatsApp first, voice next. Describe the agent, Archon builds it, Salesforce governs it, on any model, at a tenth of the price per conversation.**

- **First market** stays the 360 SMS App customer base: Salesforce orgs that already run WhatsApp and SMS, in India and the Middle East, with lead qualification, support and revival as the three uses. The market summaries name exactly these as the agents in highest demand, with WhatsApp agents and Hindi and regional-language voice called out for India.
- **A second channel**: agencies. The 360 SMS partner and reseller base is an agency channel; a white-labelled, multi-tenant Archon offered through it is distribution no competitor has. This needs a sponsor decision (section 9).
- **Proof points** we already have and should show: approvals in the chat, every conversation on record, per-turn phase timings, dollars per conversation, the test harness that scores built agents. Buyers in the research call out "evals and guardrails" as the gap most platforms have; ours is built, it is just not visible.

## 5. The plan: three tracks

### Track A · Runtime: cost and latency on the WhatsApp agent

Each lever is measured on the same agent with a before-and-after table from the phase timings and token fields.

| Lever | Saves | Effort |
|---|---|---|
| Always-on hosting for the server and the CRM connector (the AWS move, or paid Render plans until then) | The 6 s sleeping-connector turns and the 30 to 90 s cold starts, every day | Money, not code |
| Typed prebuilt tools with bound fields in place of the generic CRM tools, and an allow-list of only the tools the agent uses | About 1.5k to 2k tokens per turn, and every describe call | Medium; the prebuilt tools exist |
| Stop reloading tools on warm turns: the Salesforce token's null expiry forces a reconnect every 20 minutes; cache identity per session | About 1.2 s per turn, and the time to first token on the web | Small |
| Speak-then-act on a gpt-5-family model for the write turns | One model call per write turn, about 1 s | Built; needs the model decision |
| Compress the agent instructions and the fixed runtime rules | About 800 tokens per turn, and better cache hits | Small |
| Reply before persisting on the WhatsApp path, as the socket path already does | About 0.6 s | Small |
| A smaller model for the intake turns (gpt-4.1-mini or gpt-5-mini) | Model loop 2.6 s to about 1.2 s; tokens at a fifth of the price | The model decision |
| Dollars per conversation on the Cost page, beside the Agentforce figure | The perception | Small |

**Targets**: at most 2,000 input tokens per turn; at most 3 cents per conversation on gpt-4.1 and under a cent on a mini model; 2.5 to 3 seconds to WhatsApp warm; first token under half a second on the web chat. Below three seconds nobody is faster, because every platform calls the same models; the aim is parity plus the governance nobody else has.

### Track B · Product: one simple path, everything else under Advanced

Today twenty pages. The product becomes four surfaces, and the rest moves under Settings and Advanced.

| Surface | What a person does there | What it replaces |
|---|---|---|
| **Build** | Pick a template or describe the agent. See "Decided for you" and answer only what is theirs. Test it in a chat. Activate. | New Agent, the Architect card, Templates, the canvas (now under Advanced), the Setup checklist |
| **Run** | A clean chat for the person using the agent, or the WhatsApp number it answers. No stage frames, no tool cards; a Details drawer for builders. | Chat, the Archon screen, the record widget |
| **Watch** | Conversations, runs, approvals and cost in dollars on one page, with "needs attention" at the top. | Conversations, Executions, Approvals, Cost, Home dashboard, Trace |
| **Settings** | Connect once (one Connect button per provider, org account by default), AI keys, people and permissions, identity policy under Advanced, server status. | Setup, Connectors, My Connections, AI Connections, Identity, Environments |

Rules for the simplification: a customer never sees a system prompt unless they open Advanced; connections default to the org account with one button, and the identity policy is an Advanced setting; the canvas stays, as the Advanced view of a built agent, because builders asked for it and the Architect writes to it; the chat a customer sees is the chat an end user sees.

**Templates.** Three, each building in one click with the Architect filling the rest and asking at most the questions in its brief:

| Template | What it does | What it asks |
|---|---|---|
| WhatsApp lead qualifier | Greets, asks the qualifying questions, writes the Lead, books a meeting as an Event, hands off on request | What makes a lead qualified; who owns the meeting |
| WhatsApp support with handoff | Identifies the customer, answers from the knowledge base, opens a Case with the right priority, hands off to a queue | Which queue; what counts as urgent |
| Closed-lost revival | On Closed Lost, opens a WhatsApp conversation from a template, negotiates within a discount floor, reopens the opportunity or logs the reason | The discount floor; who approves beyond it |

### Track C · Position and voice

- The website and the pitch say the sentence in section 4. The employee-assistant demo is retired. The pricing page frames per-conversation cost against Agentforce's.
- **Voice is visible now and built properly next.** A "Voice, coming soon" tile on Build, honest about the date. The plan behind it: a telephony bridge (Twilio Media Streams or an Indian carrier equivalent) into a realtime speech model with tool calls, because callers need replies under a second and the text pipeline cannot do that; the same tools, approvals, transcript objects and handoff as chat; Hindi and regional languages through the model's speech support. It is a new channel bridge and a new turn loop, not a restructure: the runtime is already channel-agnostic.
- The evals and observability we have become sales material: the harness report, the trace page, the phase timings, dollars per conversation.

## 6. What is deliberately not in this plan

Coding, browser and generic research agents. A general-purpose workflow tool to rival n8n's connector count. Model training. Phone voice before chat is sharp. The connector pack and the n8n parity nodes from document 02 stay on the list but move behind these three tracks (section 8).

## 7. Measures of success

The plan is done when a prospect can be shown, live:

1. A WhatsApp lead qualifier built from the template in under five minutes, with one or two questions asked and the rest decided for them.
2. A WhatsApp reply in under three seconds, warm, on three consecutive turns, with the phase timings shown.
3. The Cost page showing the conversation's cost in dollars, next to the Agentforce figure.
4. A handoff to a person and a return, in the same demo.
5. Four surfaces in the app, with nothing a customer has to understand that a senior admin would not.

And the measured table for track A, before and after, in this document's next version.

## 8. Sequence and what changes in document 02

Weeks 1 and 2: hosting (A), tool reload and identity caching (A), dollars on the Cost page (A), the Build surface with "Decided for you" and the three templates behind it (B). Weeks 3 and 4: typed tools and the allow-list, the instruction compression and the model decision on the intake agent, measured (A); the Run surface (B). Weeks 5 and 6: the Watch and Settings surfaces (B); the website and pitch (C); the voice tile (C). Weeks 7 and 8: the live demo rehearsal against section 7, and the measured table.

Document 02's epics are re-ordered: this plan first; then E1 (the review findings, still required before any paying customer), E5 (handoff completion, needed for template two), E2 (field verification); then the rest as listed. E11 (AWS) moves into week 1 of this plan.

## 9. Decisions the sponsor owns

1. The model per role: the intake and support agents' chat turns (a mini model, or a gpt-5-family model for speak-then-act), and the Architect's tiers.
2. Hosting: the AWS date, or paid Render plans in the meantime, and the monthly budget.
3. The four-surface structure and which pages are cut, after the mockups.
4. The agency channel through 360 SMS: white-label and multi-tenant, yes or no, and when.
5. The voice vendor and the date voice becomes a promise rather than a tile.
6. The website claims to change now.

## 10. Mockups

Three screens, Build, Run and Watch, are published as a page beside this document so the decision in item 3 is made on something you can see. They show the dark product theme as it is today, with the new structure: the template row and the "Decided for you" list on Build; the clean customer chat with a Details drawer on Run; the one-page Watch with cost in dollars.
