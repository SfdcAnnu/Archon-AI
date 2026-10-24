# Archon — Product Requirements, Next Release

| | |
|---|---|
| Document | 02 · Product requirements for the next release |
| Product | Archon, by Aeventra AI |
| Version | 0.1, draft for review |
| Date | 24 October 2026 |
| Owner | Annu (sponsor and product owner) |
| Audience | The engineers who will build the release, the sponsor who decides scope, and whoever writes the tests |
| Traces to | [00 · Charter](00-business-case-and-charter.md) section 6 (scope) and 10 (decisions); [01 · Architecture](01-solution-architecture.md) section 13 (known gaps) and 15 (open questions) |
| Tested by | [04 · Test strategy](04-test-strategy.md), which gives every requirement here a test |

This document says what the next release ships, for whom, and how we will know each item is done. Items are grouped into epics in the order already agreed with the sponsor. Each requirement has an id, a priority, acceptance criteria, and the place it came from. Anything marked **[decision]** waits for a sponsor decision listed in section 7.

Priorities follow MoSCoW: **Must** ships or the release does not; **Should** ships unless time runs out; **Could** ships if cheap; **Won't** is named so nobody wonders.

## 1. The release in one paragraph

The next release makes Archon trustworthy enough to put in front of a paying customer: the builder stops guessing about the org (field verification), the platform stops holding secrets carelessly (the security fixes), a person can finish every conversation path that exists today (handoff completion, background writes on a model that speaks and acts), the automation side proves itself on one hard real build, and the first connector pack gives agents hands outside Salesforce. The n8n parity nodes, Stop generating and the JWT package design follow in that order if time allows. The AWS move is an enabler that this release prepares for and does not depend on.

## 2. Who this release is for

| Persona | What they get from this release |
|---|---|
| Salesforce admin or builder | Builds that use real field and picklist names, fewer setup questions, a canvas with retry and routing nodes, connectors beyond mail and Drive |
| Sales and support person | A handoff that works in the record widget as well as the app, replies that keep coming while writes finish in the background, a Stop button |
| Customer on WhatsApp | Faster replies on writes, a person when they ask for one, a return to the agent after |
| IT and security | The findings from the architecture review closed, a package that regenerates cleanly, keys sealed everywhere they rest |

## 3. Goals and measures

| Goal | Measure | Baseline (24 Oct 2026) | Target |
|---|---|---|---|
| Builds use only real org fields | Field-check findings per build on the comm-test cases | 0 bad fields in round 2 of 1 Oct, measured on 6 cases | 0, and picklist values and relationship paths covered too |
| Builder accuracy | Builder scorecard, comm-tests C1–C6 | 86–89 percent | ≥ 90 percent |
| Conversation accuracy | Conversation checks, comm-tests | 98 percent (65/66) | ≥ 98 percent, no regression |
| Write turns feel instant | Warm write-turn time with Background on, on a model that emits text with tool calls | 3.7 s on gpt-4.1 (two model calls) | ≤ 2.0 s |
| Automation build quality | Sponsor's grade on one live build of "Account Pipeline Review" | Deal Risk Review 8/10 (28 Sep) | ≥ 8/10, re-runs re-read the org |
| Security findings closed | Architecture section 13 items 5–12 | 0 of 8 | 8 of 8 |
| Package regenerates | `scripts/build-package-source.py` exits 0 on current `force-app` | fails (WhatsApp dependency) | passes, package version created in the Dev Hub |
| Handoff proven live | One WhatsApp conversation handed to a person and returned | not done | done, with the transcript lines on record |

## 4. Scope by epic

### E1. Close the architecture review findings

The findings come from [01 · Architecture](01-solution-architecture.md) section 13. They are small individually and the review will ask about every one of them.

| Id | Requirement | Priority | Acceptance criteria | Source |
|---|---|---|---|---|
| R1.1 | An asynchronous automation run produces exactly one `AgentExecution__c` row, whose `CorrelationId__c` is the id the server uses for the run | Must | Start an async run from `AgentRunner`; after completion there is one row, status SUCCESS or ERROR, score and output filled; the route passes its correlation id into `runAgent` and `GET /api/agent/status/:id` returns the run's status instead of a stub | Gap 1, 2 |
| R1.2 | The committed `JwtSecret__c` value and the field are removed from the repository and the object; nothing reads them | Must | The custom metadata record has no `JwtSecret__c`; `ArchonConfig__mdt` has one field, `ServerUrl__c`; the package build's forbidden-token check no longer needs the exclusion | Gap 5 |
| R1.3 | The org's server credential is not readable by ordinary users | Must | `ArchonInstall__c` is `Protected`; the React app still works for an Archon Admin; a user with only Archon Agent Invoker cannot query the key | Gap 6 |
| R1.4 | The AI key never rests unsealed in Postgres | Must | `WsTicket.engineOverride` and `AgentRun.engineOverrideJson` are sealed with `ENCRYPTION_KEY` (or the key is replaced by a reference the server resolves from `AiEngineConnection__c` through the org connection); the backfill script covers both tables | Gap 7 |
| R1.5 | An artifact can be read only by the org that produced it | Must | `GET /api/artifacts/:id` returns 404 for another org's session key | Gap 8 |
| R1.6 | A chat-only user can use the React chat page | Must | The Archon Agent Invoker permission set grants `AgentChatRestService`, `AgentConversationsRestService`, `AgentWebSocketController`, `AgentListRestService` (read paths only); a user with only that set starts a session, sends a turn over the socket, and sees their conversations; they still cannot save an agent | Gap 12 |
| R1.7 | Trace retention runs whenever traces are captured | Should | With `TRACE_CAPTURE=full` and no `ADMIN_API_KEY`, the sweep still runs every 6 hours | Gap 10 |
| R1.8 | Abandoned rows are swept | Should | `PendingOAuth` older than 10 minutes, `ConnectionReminder` of disconnected providers, `BackgroundToolRun` older than 30 days, `MobileSession` past expiry and `AgentRun` in a final state older than 90 days are deleted on a schedule; the numbers are env-tunable and documented in the runbook | Gap 14 |
| R1.9 | The server can run as more than one instance | Should | `PLATFORM_TOKEN_SECRET` is required in production (boot fails without it); the run poller and the handoff poller claim rows atomically before acting; the tool-list, membership and artifact caches are either shared (Postgres) or safe to be per instance; documented in the architecture | Gap 13, 15 |
| R1.10 | CRUD and FLS are enforced the way the security review expects | Should | Every REST class uses `WITH USER_MODE` or `Security.stripInaccessible` on reads and `as user` DML, except the two deliberate `without sharing` paths, which are documented; PMD suppressions are removed | Gap 9 |
| R1.11 | The mail connector servers run tools under the live request's bearer and log no bearer prefixes | Should | Gmail and Outlook servers use the same `AsyncLocalStorage` pattern as the CRM server; the request logger prints no token characters | Gap 11 |
| R1.12 | An automation that pauses at an approval node creates an `AgentApproval__c` row a person can decide | Must | When a run pauses with an approval token, the server (through the org connection) or Apex inserts the row with the token, run id, node label, record and timeout; the Approvals page shows it; deciding it resumes the run; the poller's auto-reject marks it TimedOut | Gap 21 |

### E2. Field verification after the survey

Today the Architect's field check covers plain field names on reads, filters, creates and updates. It does not check picklist values, relationship paths, or whether a missing field should become a setup item, and the designer still asks questions the org could answer.

| Id | Requirement | Priority | Acceptance criteria | Source |
|---|---|---|---|---|
| R2.1 | Picklist values used in a design are verified against the org | Must | A design that filters or writes `Status = 'Qualified'` on an object whose picklist lacks that value is repaired with the closest real value or reported as a gap; comm-tests C3–C6 produce no invented picklist values | Memory 2: field verification |
| R2.2 | Relationship paths are verified | Must | `Account.Owner.Email`, `Opportunity.Contact__r.Phone` and similar paths are checked segment by segment against describes; a bad segment is reported with the nearest real relationship name | same |
| R2.3 | A field the requirement needs but the org lacks becomes a setup item, not an assumption | Must | The gap report lists "Create field X on object Y (type)" as a blocking prerequisite; the compiled agent's node that needs it is disabled until the field exists, as with connectors today | same |
| R2.4 | Questions the org can answer are answered from the org | Should | The analyst's open questions are filtered: object existence, record types, picklist values and existing automation are answered from the survey and shown as facts, not questions; the user sees only questions the org cannot answer | same |
| R2.5 | A rebuild re-reads the org rather than trusting the previous description | Should | Rebuilding an agent after a field was added produces a design that uses the field; the survey is never served from a checkpoint | Memory: "re-runs trust the old description" |

### E3. Automation close-out

| Id | Requirement | Priority | Acceptance criteria | Source |
|---|---|---|---|---|
| R3.1 | One live Architect build of the "Account Pipeline Review" requirement (loop, if/else, several connectors) is graded by the sponsor | Must | The build completes under the $4 ceiling; the sponsor grades ≥ 8/10; findings become requirements or bugs | Memory 2b: user wants to test a complex automation |
| R3.2 | A paused `resume_build` that is refused tells the copilot so plainly that it cannot claim success | Must | The tool result starts with `REFUSED:`; the copilot's reply names the refusal; a test asserts the wording | Memory 2: resume_build |
| R3.3 | The execution view shows each node's input and output side by side | Should | Executions page: a step row expands to input (the node config with tokens filled) and output (the node result) with timing; works for loops (one row per iteration) | n8n gaps |
| R3.4 | The automation preview and the saved canvas show the same steps | Should | For a built automation, the design preview graph and the saved `AgentNode__c` rows have the same node count, ports and labels | Memory 2: preview |

### E4. Background tools in use

| Id | Requirement | Priority | Acceptance criteria | Source |
|---|---|---|---|---|
| R4.1 | The WhatsApp intake agent's create and update nodes run in the background on a model that speaks and acts in one message | Must | Background is on for the two nodes; the AI node runs a gpt-5-family model **[decision]**; a 7-turn measured conversation shows write turns at ≤ 2.0 s warm and one model call per write turn | Memory 1 |
| R4.2 | A failed background write reaches the customer, not only a Task | Could | On a failed or unconfirmed write in a WhatsApp session, the server sends one corrective message through the org's WhatsApp path (needs a server-to-360 SMS send; today only Apex can send) | Memory 1: not built |

### E5. Handoff completion

| Id | Requirement | Priority | Acceptance criteria | Source |
|---|---|---|---|---|
| R5.1 | The record-page widget shows the handoff state and lets a person reply or return | Must | `archonChat` shows the same banner, reply box and Return control as the Conversations page; a reply is written as a Human row and sent on the session's channel | Architecture gap 4; memory: handoff open items |
| R5.2 | The Architect places a "Hand off to a person" node when the requirement asks for escalation | Should | Requirements C4–C6 of the comm-tests, which mention escalation, produce a handoff node wired to the AI node, with the queue or owner chosen from the requirement | same |
| R5.3 | Closing an Omni-Channel work item returns the conversation to the agent | Should | A trigger on `AgentWork` (or a packaged Flow template) sets the session back to Active when the work item closes; the return line is written and sent | same |
| R5.4 | One live WhatsApp handoff is exercised end to end | Must | A customer message triggers a handoff; the person is notified; the person replies; the customer sees the reply; the person returns the conversation; the next agent turn reads the lines | sponsor's own test |

### E6. Connector pack

Order follows the agreed priority. Each connector ships as a catalog record, a server (ours or the provider's), and Architect vocabulary so a requirement can reach it.

| Id | Requirement | Priority | Acceptance criteria | Source |
|---|---|---|---|---|
| R6.1 | Company and lead enrichment (Apollo) | Should | An agent can enrich a Lead or Account by domain or email; results map to named fields the builder chose; the key is an org connector with an API key; the builder offers it when a requirement says "enrich" | Memory 3 |
| R6.2 | Document generation (PDF or DOCX from a template, attached to the record) | Should | A tool takes a template and a record, produces a file, attaches it as a ContentDocument linked to the record, and returns the link; Demo 4 "proposal in one message" works | same |
| R6.3 | Generic HTTP connector with pre-registered endpoints per org | Should | An admin registers an endpoint (name, method, URL, auth style, schema) under Connectors; agents call it by name; the compiler still refuses raw URLs | same |
| R6.4 | PDF and document reader | Could | A tool extracts text from a ContentDocument (PDF, DOCX, TXT) for an agent to read | same |
| R6.5 | Slack and Teams servers behind the catalogued records | Could | Post a message to a channel, read a channel; identity per user or org; Microsoft route **[decision]** | same |
| R6.6 | Calendar through the Gmail and Outlook servers | Could | List, create and move events; booking scenario C5 uses it instead of Salesforce Events when the org prefers | same |

### E7. Canvas parity with n8n

Whether these are canvas-only or also known to the Architect is a sponsor decision **[decision]**; the acceptance criteria below are for the canvas, with the Architect column marked.

| Id | Requirement | Priority | Acceptance criteria | Architect-aware |
|---|---|---|---|---|
| R7.1 | Pinned test data and a per-step execution view | Should | A builder can pin a sample input on a trigger and run the automation from the canvas; each node shows its input and output (shares R3.3) | no |
| R7.2 | Retry and on-error per node | Should | A node has retry count, back-off and an `error` port; a failed step with retries exhausted follows the error port instead of stopping the run | decision |
| R7.3 | Switch node | Should | Multi-way routing on a value with named ports; the walker follows the matched port, else `default` | decision |
| R7.4 | Merge node | Could | Waits for several incoming branches and combines their outputs; the walker tracks which branches arrived | decision |
| R7.5 | Code node | Could | A sandboxed expression or small script step (no network, time-limited) that maps inputs to outputs; refused by the compiler unless the sponsor allows it in builds | no |

### E8. Stop generating

| Id | Requirement | Priority | Acceptance criteria | Source |
|---|---|---|---|---|
| R8.1 | A person can stop a turn over the WebSocket | Should | A Stop control appears while a turn streams; a `stop` frame aborts the model call between steps, never mid-tool-call; the partial reply is persisted and marked interrupted; streamed tokens are counted; the budget brake's `user_stopped` variant produces the reply; final versus resumable per **[decision]** | Memory: stop generating design |

### E9. JWT in the package

| Id | Requirement | Priority | Acceptance criteria | Source |
|---|---|---|---|---|
| R9.1 | The per-user Salesforce JWT bearer flow works from the managed package without per-customer setup, or with bring-your-own-key, per the sponsor's choice **[decision]** | Should | A packaged External Client App with Archon's certificate (or the customer's); the server holds the private key in a secret store; an admin turns `sfJwtEnabled` on in Settings and a user with no personal connection runs Salesforce tools as themselves; pre-authorised profiles or permission sets documented | Charter decision 5 |

### E10. Packaging and documentation hygiene

| Id | Requirement | Priority | Acceptance criteria | Source |
|---|---|---|---|---|
| R10.1 | The package source regenerates from the current `force-app` | Must | The WhatsApp send sits behind an interface (`ArchonMessageSender`) with the 360 SMS implementation outside the package; `build-package-source.py` passes; `sf package version create` succeeds in the Dev Hub; a scratch org install passes the Apex tests | Gap 16 |
| R10.2 | `PACKAGING.md` is rewritten for Archon and the old documents move to `docs/archive/` | Must | No mention of Synapse or `synpsai`; the README index lists the archive | Gap 17 |
| R10.3 | The connector catalog matches the servers | Should | CRM record description names only what the server does; Gmail scopes match the server; the Metadata server README no longer says "not wired" | Gap 18 |
| R10.4 | Dead paths are removed or finished | Could | Automation channel nodes, `apex_action`, `einstein`, `sentiment`, `embed`, the in-process stub servers, the unused GraphQL client and the unused Architect fallback path are removed, or each gets a ticket with an owner | Gap 3, 19 |
| R10.5 | The website claims match the product | Must | Decision 8 of the charter applied: phone-call voice and same-day go-live either removed or scheduled | Gap 20 |

### E11. Platform move to AWS (enabler)

| Id | Requirement | Priority | Acceptance criteria | Source |
|---|---|---|---|---|
| R11.1 | The server runs always-on with a managed Postgres and a secret store | Should | No cold starts: `/health` answers in under a second at any hour for a week; secrets (`ENCRYPTION_KEY`, OAuth secrets, JWT private key, `PLATFORM_TOKEN_SECRET`) come from the secret store; the runbook's deploy section is rewritten for the new target | Charter risk 1 and decision 3 |
| R11.2 | The connector servers follow, or stay on Render paid plans | Should | No connector wake loop is needed in a build; the 45-second wake budget never triggers | same |

### E12. Demo agents (Could)

Briefs exist from 25 September: Agent 1 WhatsApp Lead Intake Qualifier v2 (enrichment, escalation, handoff, known-name skip), Agent 2 WhatsApp Support (knowledge base, Case, gated replacement, escalation, handoff), Agent 3a Deal Risk Scorer (automation with risk fields and a Flow), 3b Pipeline Manager Assistant (approved emails), Demo 4 Proposal in one message. Each is built through the copilot once its epic lands (E5 for 1 and 2, E3 for 3a and 3b, E6 for 4). They are acceptance vehicles, not requirements of their own.

## 5. Non-functional requirements

| Area | Requirement | How it is checked |
|---|---|---|
| Latency | Warm chat turn without tools ≤ 2.5 s; with one tool ≤ 4.5 s; write turn with Background ≤ 2.0 s on a speak-and-act model | `PhaseMsJson__c` on the measured turns; the 7-turn driver before and after |
| Cost | An Architect build ≤ $0.50 at steady state and never above its ceiling; a customer turn costs the customer, never the platform | Build `steps[].calls` costs; no server-side agent key |
| Security | Items in E1 closed; no secret in git; every REST surface authenticated; secrets sealed at rest; traces redacted | Review checklist in doc 04 section 9 |
| Reliability | At-least-once runs stay idempotent; approvals fail closed; a restart leaves no silent orphan (Task per orphan); turns are idempotent for 2 minutes | Existing tests plus R1.8 and R1.9 |
| Multi-tenancy | Every Postgres query scoped by org; every Salesforce call on the org's own connection; namespace detected per org | Existing tests `namespace`, `installs-cache`, identity tests |
| Edition compatibility | No Platform Events, CDC or streaming; API access is the one gate | Package install test on a Professional Edition scratch definition (new) |
| Observability | Every turn carries phase timings; every run carries per-step rows; `/health` reports the build | Existing |
| Data retention | Traces 90 days, payloads 14; tickets 45 s; approvals 24 h; the new sweeps in R1.8 | Runbook section 11 |

## 6. Out of scope for this release

Voice on telephone calls. A mobile app beyond the demo. Model training or fine-tuning. A second WhatsApp provider. Billing and plan enforcement inside the product. Any change to the chat protocol that would break the LWC widget.

## 7. Decisions the sponsor owns for this release

1. The model for the intake agent's AI node in R4.1 (a gpt-5-family model is needed for one-call write turns).
2. Microsoft: Microsoft's hosted Work IQ servers or a self-hosted Graph server (affects R6.5 and R6.6).
3. JWT shape for R9.1.
4. Whether the n8n nodes in E7 are Architect-aware.
5. Stop generating: final or resumable (R8.1).
6. The AWS date and budget (E11).
7. Which website claims to remove or schedule (R10.5).
8. Which stub paths to delete (R10.4).

## 8. Sequencing and definition of done

The epics run in order E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8 → E9, with E10 spread across the release (R10.1 and R10.2 early, because the package must build before any customer install) and E11 scheduled by the sponsor. Each item is explained, mocked where it has a screen, approved, built, verified in the real org, committed and pushed before the next starts (charter section 11).

Definition of done for a requirement: acceptance criteria met and shown (a screenshot, a transcript or a test run); type checks and unit tests pass on both repositories; Apex tests pass in the org; the change is committed on main and merged into Release, Dev and Pre-Release; the server's Release is live and `/health` shows the commit; the runbook and this document are updated if behaviour changed; the live-model budget for the item was agreed before it was spent.

## 9. Risks specific to this release

| Risk | Effect | Mitigation |
|---|---|---|
| Speak-then-act depends on the model emitting text with tool calls | R4.1 cannot be met on gpt-4.1 | Decide the model first; measure once |
| Cold starts keep killing builds during E2 and E3 verification | Wasted paid builds | Wake the two MCP hosts before every build; schedule E11 early if the sponsor can |
| The package refactor (R10.1) touches the WhatsApp path that live demos use | A broken demo | Keep the 360 SMS implementation as the default binding in the dev org; test the live path after |
| The connector pack needs third-party accounts and keys | Items stall | Sponsor supplies Apollo and document-renderer accounts before E6 starts |
| Security fixes change permission sets and settings | Admins locked out | Test with a user holding only each permission set before release |

## 10. Traceability

| Requirement | Charter goal (section 5) | Architecture pointer | Test ids (doc 04) |
|---|---|---|---|
| R1.1–R1.12 | Nothing happens without control | Section 13, items 1–15 and 21 | T-E1.* |
| R2.1–R2.5 | An admin builds a working assistant from a description | Section 5.4, `architect/field-check.ts` | T-E2.* |
| R3.1–R3.4 | Assistants do what they were asked | Section 5.3, 9.7 | T-E3.* |
| R4.1–R4.2 | Replies feel instant | Section 9.6 | T-E4.* |
| R5.1–R5.4 | Customers get a person when they ask | Section 9.5 | T-E5.* |
| R6.1–R6.6 | Scope: connector pack | Section 6, appendix B | T-E6.* |
| R7.1–R7.5 | Scope: n8n gaps | Section 5.3 | T-E7.* |
| R8.1 | Replies feel instant (control) | Section 5.2, `lc/turn-budget.ts` | T-E8.* |
| R9.1 | Nothing happens without control | Section 6, 10.2 | T-E9.* |
| R10.1–R10.5 | Risks: AppExchange review | Section 11, 13 | T-E10.* |
| R11.1–R11.2 | Risks: cold starts | Section 11, 12.4 | T-E11.* |
