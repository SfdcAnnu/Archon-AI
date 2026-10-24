# Archon — Deployment and Operations Runbook

| | |
|---|---|
| Document | 05 · Deployment and operations runbook |
| Product | Archon, by Aeventra AI |
| Version | 0.1, draft for review |
| Date | 24 October 2026 |
| Owner | Annu (sponsor and operator) |
| Audience | Whoever releases, watches or repairs Archon: today the sponsor and the AI sessions working with them; later an operations engineer |
| Traces to | [01 · Architecture](01-solution-architecture.md) sections 3, 11 and 12; [04 · Test strategy](04-test-strategy.md) section 10 (release gate) |

Everything here was read from the code, the scripts and the sessions that ran them. Where a step has only been done by hand in a dashboard and is not in any file, it says **to confirm**.

## 1. The systems

| System | Where | Source and branch that runs | Health | Dashboard |
|---|---|---|---|---|
| Development org `AiAgentBuilderOrg` | `orgfarm-ac9142a7a9-dev-ed.develop.my.salesforce.com`, API 68.0 | `SfdcAnnu/Archon-AI`, deployed from the working copy of main | Open the Archon Agent Builder app; Setup tab shows server status | Salesforce Setup |
| Archon server | `https://aeventra-ai-agent-server.onrender.com` (Render, free tier) | `SfdcAnnu/Aeventra-AI-Agent-Server`, branch **Release** | `GET /health` → `{status, commit, branch, bootedAt}` | Render dashboard, service logs |
| Postgres | Render Postgres, pgvector | migrations in `server-langchain/prisma/migrations`, applied by `prisma migrate deploy` at every start | `/health` fails if the database is down | Render dashboard |
| Salesforce CRM connector | `https://salesforce-mcp-server-02e7.onrender.com` | `SfdcAnnu/Salesforce-MCP-Server`; Dev → main → Pre-Release and Release; deployed branch **to confirm** | `GET /` → `{version, build}` (build marker, v70 today) | Render |
| Salesforce Metadata connector | `https://salesforce-metadata-mcp.onrender.com` (starter plan, own Postgres) | `SfdcAnnu/salesforce-metadata-mcp`; Render deploys from main per the 19 Sep note, `render.yaml` in the repo | `GET /health` → commit | Render |
| Gmail connector | `https://gmail-mcp-server-baqd.onrender.com` | `SfdcAnnu/Gmail-MCP-Server`, configured by hand | `GET /` | Render |
| Outlook connector | `https://outlook-mcp-server-y4wg.onrender.com` | `SfdcAnnu/Outlook-MCP-Server`, configured by hand | `GET /` | Render |
| Google Drive | `https://drivemcp.googleapis.com/mcp/v1` (Google-hosted) | none | n/a | Google Cloud console (the OAuth client) |
| Marketing site | aeventra.com (not deployed yet) | `aeventra-website` | | |

Branch flow for the Salesforce and server repositories: work lands on main; main is merged into Release, Dev and Pre-Release and all four are pushed. The CRM connector repository is the other way round: work lands on Dev, Dev merges into main, main into Pre-Release and Release.

## 2. Access you need

- Salesforce CLI authenticated to `AiAgentBuilderOrg` (`sf org list` shows it Connected). The default org is set in `.sf/config.json`.
- GitHub as `SfdcAnnu` with push rights to the seven repositories. The Git Credential Manager prompt does not work from an automated shell; push with `GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0` so git falls through to the stored credential.
- Render dashboard for the five services and the database.
- Google Cloud project that owns the OAuth client (Gmail, Drive) and the Microsoft app registration (Outlook).
- Node 22 for every JavaScript tool. On this machine Node is not on PATH: prefix commands with `export PATH="/c/Users/Annu/AppData/Local/nvm/v22.17.1:$PATH"`.
- Python 3 for `scripts/build-package-source.py` and the Mermaid document tooling.

Model provider keys are never operator secrets: each org binds its own `AiEngineConnection__c` to its agents.

## 3. Daily checks

1. `curl https://aeventra-ai-agent-server.onrender.com/health` and read `commit` and `branch`. If it takes longer than a few seconds the service was asleep; that is normal on the free tier.
2. In the app: Home → the needs-attention list (failed runs, pending approvals, agents with no key); Setup → Wake servers shows every connector host online.
3. Render logs for `ws_turn_persist_failed`, `async_run_failed`, `handoff_poller_sweep_failed`, `lc_turn_complete` with `tripped`.
4. Conversations → Trace page for any turn a person reported as slow or wrong: read `PhaseMsJson__c` before theorising.

## 4. Releasing

### 4.1 Salesforce package (Apex, objects, React app)

```bash
export PATH="/c/Users/Annu/AppData/Local/nvm/v22.17.1:$PATH"
cd force-app/main/default/uiBundles/AgentBuilderApp
npm run build > build.log || { tail -40 build.log; exit 1; }   # check-colours → tsc -b → vite build; dist/ is committed
cd ../../../../..
sf project deploy start --source-dir force-app -o AiAgentBuilderOrg -w 30     # or only the bundle: --source-dir force-app/main/default/uiBundles/AgentBuilderApp
sf apex run test -o AiAgentBuilderOrg --test-level RunLocalTests --code-coverage --result-format human -w 30
```

Then commit on main by path (another session may share the checkout: check `git status` and the last commits first), merge and push:

```bash
git add <paths> && git commit -m "<what changed and why>"
cd /c/tmp/relwt && git fetch -q origin
for b in Release Dev Pre-Release; do git checkout -q $b && git merge -q --no-edit main; done
git checkout -q Release
GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0 git push origin main Release Dev Pre-Release
for b in main Release Dev Pre-Release; do echo "$b $(git rev-parse --short $b) $(git rev-parse --short origin/$b)"; done   # must match
```

Notes. `manifest/package.xml`, `package-chat.xml` and `package-connectors.xml` exist for manifest-based deploys (`sf project deploy start --manifest manifest/package.xml`) when only one area changed. Deploying does not commit: the sponsor expects Release to reflect what is live. The React build fails on any hard-coded colour by design. Apex anonymous scripts under `scripts/apex` must be written without a BOM (PowerShell `Set-Content -Encoding utf8` adds one). A destructive change (removing a field or class) needs a `destructiveChanges.xml` manifest; the plain deploy never deletes.

### 4.2 Archon server

```bash
cd server-langchain
npm run lint          # tsc --noEmit
npm test              # vitest, 395 tests
git add <paths> && git commit -m "..."
# merge main into Release, Dev, Pre-Release (worktree C:/tmp/srvwt or checkout), then push:
GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0 git push origin main Dev Pre-Release
GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0 git push origin Release        # this one deploys; keep it a standalone command
```

Render builds Release in about two minutes. Poll `/health` until `commit` is the new one. Migrations run at start (`prisma migrate deploy && tsx src/index.ts`); a migration must be backward compatible with the previous code because the old instance keeps serving until the new one is healthy. **A Release push restarts the server:** builds in flight are failed and swept at boot (`failOrphanedBuilds`), queued background writes are failed and leave Tasks, open chat sockets drop and reconnect on the next send. Release in a quiet window and never during a paid test run.

Order when a change spans both sides: server first when Apex depends on a new route; Salesforce first when the server depends on a new field (the server reads fields by name and tolerates missing ones only where the code says so, for example `TurnStatus__c` and `IsSystem__c`).

### 4.3 Connector servers

CRM: commit on Dev, merge into main, then Pre-Release and Release; bump the build marker in `src/server.ts` so the deploy is visible at `GET /`. Metadata: commit on main, fast-forward the other branches, push all; `/health` reports the commit. Gmail and Outlook: all four branches point at the same commit; push and let Render build. Archon's runtime caches tool lists for four minutes, so a new tool appears within that time without a server restart.

### 4.4 Managed package

```bash
python scripts/build-package-source.py          # copies git-tracked force-app into ArchonPackage/force-app, excludes the demo and 360 SMS pieces
cd ArchonPackage
sf package version create --package Archon --installation-key-bypass --wait 30 --code-coverage   # Dev Hub to confirm
```

The copy is stale (27 September) and the script's forbidden-token check now trips on `AgentHandoffService` (see requirement R10.1). No package version has been created yet; the Dev Hub alias is not in any config file.

### 4.5 System agents

After a server release that bumps a spec version, a managed agent (`archon_copilot`) re-syncs itself on first use. An unmanaged one (`metadata_expert`) does not: run `POST /api/system-agents/sync {apiName, refreshInstructions:true}` through `scripts/apex/real/metadata-expert-refresh.apex` to rewrite its wording only.

## 5. Rollback

| What | How |
|---|---|
| Server | Render → Deploys → "Rollback" to the previous deploy (fastest), or `git revert <sha>` on main, merge into Release, push Release. A migration cannot be rolled back automatically: write a down migration or restore the database from a Render snapshot **to confirm the snapshot schedule**. |
| Salesforce metadata | `git checkout <good-sha> -- force-app` then `sf project deploy start --source-dir force-app`; the committed `dist/` means the old React build comes back with it. Fields and classes added by the bad release stay until a destructive deploy removes them. |
| Connector servers | Same as the server: Render rollback or revert and push. |
| A system agent | Lower is not possible: bump the spec version with the corrected content and let the sync rewrite the nodes. |
| An org's install | Setup → Reset, then run Setup again; the session key changes and the server forgets the admin's tokens. Connector rows survive. |

## 6. Configuration

### 6.1 Salesforce

| Item | Where | Value today |
|---|---|---|
| Server URL | `ArchonConfig__mdt` record `Default`, `ServerUrl__c` | `https://aeventra-ai-agent-server.onrender.com` |
| WebSocket allow-list | CSP trusted site `ArchonServerWebSocket` (connect-src) | `wss://aeventra-ai-agent-server.onrender.com` |
| Callout allow-list | Remote site `Aeventra_Server` | `https://aeventra-ai-agent-server.onrender.com` |
| Connector catalog | `ConnectorCatalog__mdt`, nine records | URLs in section 1; OneDrive, SharePoint, Slack, Teams have no URL yet |
| Permission sets | `AgentBuilderUser` (Archon Admin), `AgentChatUser` (Archon Agent Invoker), `LeadQualificationFields` (demo) | assign per person |
| Org token cap | `AgentGuardrails__c` via Settings | per org |
| Session key | `ArchonInstall__c.SessionKey__c`, written by Setup | never edit by hand |

### 6.2 Server environment variables

Set in the Render service (today) or the AWS secret store (planned). Defaults are the code's.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Listen port |
| `NODE_ENV` | development | `production` enforces https on the socket upgrade |
| `LOG_LEVEL` | info | pino level |
| `DATABASE_URL` | required | Postgres, `postgres://` or `postgresql://` |
| `SERVER_PUBLIC_URL` | http://localhost:3000 | Builds OAuth redirect URLs and the `wsUrl` handed to the browser |
| `ENCRYPTION_KEY` | none (warns) | 32 bytes, hex or base64; seals tokens and keys at rest. After setting it, run `npm run secrets:backfill` |
| `PLATFORM_TOKEN_SECRET` | random at boot | Signs per-turn platform tokens; set it explicitly before running two instances |
| `ADMIN_API_KEY` | none | ≥ 16 chars enables `/admin/traces` and the retention sweep |
| `TRACE_CAPTURE` | off | `full` records turns (redacted) into Postgres |
| `TRACE_MAX_STEPS`, `TRACE_QUEUE_MAX`, `TRACE_SHED_PAYLOADS_AT`, `TRACE_MAX_BODY_CHARS` | 120, 200, 80, 200000 | Trace capture limits |
| `TRACE_PAYLOAD_RETENTION_DAYS`, `TRACE_RETENTION_DAYS`, `TRACE_SWEEP_INTERVAL_MS`, `TRACE_SWEEP_BATCH` | 14, 90, 6 h, 500 | Trace retention |
| `SF_LOGIN_URL` | https://login.salesforce.com | Token host for code exchange and refresh |
| `SF_MCP_CLIENT_ID`, `SF_MCP_CLIENT_SECRET` | required for Setup | The External Client App used by org Setup, per-user connections and mobile (PKCE) |
| `SF_CLIENT_ID`, `SF_CLIENT_SECRET` | optional | Client-credentials connection used by the legacy in-process CRM helpers |
| `SF_JWT_CLIENT_ID`, `SF_JWT_PRIVATE_KEY`, `SF_JWT_LOGIN_URL` | optional | Per-user JWT bearer flow; the policy switch refuses to turn on without them |
| `SF_REMOTE_MCP_URL` | optional | Legacy single CRM server when an agent has no connectors |
| `SF_PACKAGE_NAMESPACE` | archon | Package namespace applied through `pkgConn` when the org has it |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Gmail and Drive OAuth |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` | optional, `common` | Outlook OAuth |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | optional | Used only by the in-process model helpers; never by agents |
| `PLATFORM_TOOLS_URL` | loopback | Where the runtime reaches `/platform` |
| `TURN_MAX_TOKENS`, `TURN_MAX_MS`, `TURN_MAX_STEPS` | 80000, 90000, 24 | Default turn budget |
| `TURN_MAX_TOKENS_CEILING`, `TURN_MAX_MS_CEILING`, `TURN_MAX_MS_CEILING_WS`, `TURN_MAX_STEPS_CEILING` | 200000, 110000, 540000, 40 | Per-node budgets cannot exceed these |
| `TURN_MAX_PARALLEL_CALLS` | 4 | Parallel specialist calls |
| `TURN_IDEMPOTENCY_TTL_MS` | 120000 | Replay window for a duplicate turn |
| `CHAT_APPROVAL_TIMEOUT_HOURS` | 24 | Chat approval expiry |
| `BACKGROUND_HOLD_MS` | 8000 | Wait on a young background write before the next reply |
| `STREAM_TEXT`, `STREAM_HOLD_CHARS` | on, 24 | Text streaming |
| `MEMORY_TRIGGER_MSGS`, `MEMORY_KEEP_MSGS` | 30, 16 | Session memory summariser |
| `RECORD_CONTEXT_MAX_VALUE_CHARS`, `RECORD_CONTEXT_MAX_CHARS`, `RECORD_CONTEXT_TTL_MS` | 300, 4000, 60000 | Record block in the prompt |
| `TOOL_RESULT_CACHE_TTL_MS`, `TOOL_RESULT_CACHE_MAX_ENTRIES`, `TOOL_RESULT_CACHE_MAX_CHARS` | 15 min, 500, 40000 | Per-session read cache |
| `TOOL_REPLAY_RECENT_COUNT`, `TOOL_REPLAY_RECENT_CHARS`, `TOOL_REPLAY_OLDER_CHARS`, `TOOL_REPLAY_TOTAL_CHARS` | 8, 3000, 500, 24000 | How much tool history is replayed to the model |
| `ARTIFACT_THRESHOLD_CHARS`, `ARTIFACT_TTL_MS`, `ARTIFACT_MAX_ENTRIES`, `ARTIFACT_MAX_CHARS` | 2000, 30 min, 200, 1M | Large tool results spilled to artifacts |
| `WS_HEARTBEAT_MS`, `STAGE_MAX_FRAMES`, `STAGE_BACKPRESSURE_BYTES` | 30000, 4000, 256000 | Socket heartbeat and frame limits |
| `HANDOFF_POLL_MS` | 60000 | Handoff quiet-period sweep |
| `ARCHITECT_BUILD_WAIT_MS`, `ARCHITECT_CALL_TIMEOUT_MS`, `ARCHITECT_REVIEW_REPAIR_MS` | 4000, 150000, 360000 | Build job timing |
| `ARCHITECT_MCP_WAKE_ATTEMPTS`, `ARCHITECT_MCP_WAKE_WAIT_MS` | 3, 15000 | Wake loop at the survey gate |
| `MAX_TOOLS_PER_AGENT_NODE` | 15 | Design validation cap |
| `MOBILE_DEMO_TOKEN`, `MOBILE_DEMO_ORG_ID`, `MOBILE_APP_SCHEME` | none, none, com.archon.demo | Mobile demo |
| `RENDER_GIT_COMMIT`, `RENDER_GIT_BRANCH` | set by Render | Reported by `/health` |

### 6.3 Connector servers

CRM: `BASE_URL`, Salesforce connected-app client id and secret, `REQUIRE_ARCHON_APPROVAL` (off by default). Metadata: `BASE_URL`, `DATABASE_URL`, `CREDENTIAL_KEY`, `APPROVAL_MODE=oauth-clients`, `ALLOW_PRODUCTION_DEPLOY=false`, `OAUTH_CLIENTS`, Salesforce connected-app callbacks `${BASE_URL}/callback` and `${BASE_URL}/approve/callback`. Gmail: `BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. Outlook: `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT`, `MS_REDIRECT_URI`.

## 7. Onboarding an org

1. Deploy the metadata (or install the package once it exists) and assign Archon Admin to the admin, Archon Agent Invoker to everyone who chats.
2. Setup tab → Connect: the admin signs in with `prompt=login consent`; the callback lands on `?archon_setup=1` and the Setup tab shows the configured email. Behind it: `ArchonInstall__c` gets the key, the server gets an `OrgInstall` row.
3. Setup → Wake servers until every host is online.
4. AI Connections → add a key per provider, mark one preferred, mark the OpenAI one for embeddings if the knowledge base is used. Bind a key to every AI node of every agent (an agent with an unbound node does not run).
5. Connectors → connect the org account for Salesforce (the Setup token is offered as the org row), and Gmail, Drive or Outlook if used; Settings → identity policy if people should act as themselves.
6. Build the first agent through New Agent; activate it; test it in Chat.
7. For WhatsApp: the 360 SMS App must be installed; point the flow's entry filter at the business number and the bridge at the agent; the package does not ship these.

## 8. Secrets and rotation

| Secret | Rotate by | Blast radius if leaked |
|---|---|---|
| `ENCRYPTION_KEY` | Set the new key, run `npm run secrets:backfill` (it re-seals `OrgInstall` and `Connector` rows; `ConnectorServerOverride` is not covered yet), restart | Every sealed token |
| An org's session key | Setup → Reset, then Setup again | That org's server access until reset |
| `SF_MCP_CLIENT_SECRET` and the other OAuth app secrets | Rotate in the provider console, update Render, restart; existing refresh tokens keep working | New sign-ins |
| `SF_JWT_PRIVATE_KEY` | New certificate on the External Client App, new key in the store | Every per-user JWT token |
| `PLATFORM_TOKEN_SECRET` | Set a new value and restart; tokens live 15 minutes | Platform tools for 15 minutes |
| `ADMIN_API_KEY` | Change and restart | The trace console |
| An AI key (customer's) | The admin edits it under AI Connections; the server never stores it durably except the two unsealed copies named in requirement R1.4 | The customer's provider account |

On a suspected leak: rotate the item above, then search the Render logs for the time window; traces are redacted, so they do not need purging for keys, but `DELETE /api/admin/traces` with `orgId` and `from` exists if a tenant asks.

## 9. Monitoring and diagnostics

- **Per turn:** `ChatMessage__c.PhaseMsJson__c` (phases, `turnMs`, `warnings`), `LatencyMs__c` (model loop only), tokens and `ModelUsed__c`; the Trace page in the app shows the raw request and response for a session.
- **Per run:** `AgentExecution__c` and the Executions page, with per-node steps from `GET /api/agent/runs/by-correlation/:id/steps`.
- **Per build:** `GET /api/architect/build/:jobId` through `scripts/apex/real/measure-build-poll.apex`: `steps[].calls[]` with model, tokens, cost and ms.
- **Server logs** (pino, Render): `archon_ai_server_started`, `lc_turn_complete`, `lc_billing`, `mcp_tool_call`, `ws_turn_persist_failed`, `async_run_complete` and `async_run_failed`, `handoff_poller_*`, `trace_*`. Prisma logs warnings and errors in production.
- **Full traces:** `TRACE_CAPTURE=full` plus `ADMIN_API_KEY`; `GET /admin/traces` lists them, redacted; retention 90 days, payloads 14.
- **Drive a turn without the browser:** `scripts/apex/real/mint-ws-ticket.apex` then `node scripts/ws-turn.mjs` runs a real socket turn; `server-langchain/ws-stream-turn.mjs` does the same from the server folder. Replay a session from `ChatMessage__c` rows before diagnosing agent behaviour.
- **Screens:** `node scripts/page-shot.cjs <route>` screenshots a page of the deployed app; `node scripts/node-shot.cjs <agent> "<node>"` a node form; `runs-shot.cjs`, `viewport-check.cjs`, `identity-ui-check.cjs`, `chat-approval-check.cjs` for their areas.

## 10. Incident playbooks

| Symptom | Likely cause | What to do |
|---|---|---|
| The app says "The Archon server is starting up" or a build sits on the survey step | Render free tier asleep (server or a connector host); a cold start can exceed 90 s | Setup → Wake servers; wait; do not add retries in the UI (sponsor decision). For builds, wake `salesforce-mcp-server-02e7` and `salesforce-metadata-mcp` first |
| Every Apex call returns `invalid_session` (401) | The `OrgInstall` row is gone (reset, or database restored) or the key in `ArchonInstall__c` differs | Setup → Reset, then Setup again |
| Server cannot act on the org: 401s from Salesforce, `refresh` errors in logs | The admin's refresh token was revoked (password change, connected-app policy, the admin deactivated) | Re-run Setup as a current admin; check the External Client App's refresh-token policy |
| An agent will not run: `NO_AI_KEY`, or "bind it to this agent's AI node" | No `AiEngineConnection__c` bound to the AI node, or the bound key's provider differs from the node's model | AI Connections → bind; the six demo agents were bound on 5 October |
| A tool is skipped with a `needs_connection` card | The node runs as the user and they have no connected account; org fallback is blocked in chat by policy | The person connects under My Connections, or the admin pins a connection on the node, or changes the policy |
| `guardrail_exceeded` | The org's daily or monthly token cap | Settings → raise or disable the cap |
| A write asked for approval and nothing happens | The `ChatApproval` row is Pending; 24-hour expiry | Approvals page (or the Archon approvals surface) → decide; after Executed the chat continues on the next send |
| Tasks titled with a background failure appear | A background write failed or timed out ("unconfirmed"), or the server restarted with queued rows | Read the Task and the System note in the transcript; redo the write by hand if the Task says unconfirmed and the record shows no change |
| A handed-off conversation never comes back | The quiet-period sweep did not run (server asleep) or `HandoffReturnAt__c` is null (no quiet period configured) | Return it from Conversations; check `handoff_poller_*` logs; the sweep also runs at boot |
| WhatsApp replies stop | `GlobalSMSSender` failing (360 SMS App credentials or template), or the flow's entry filter number changed | Look for the fallback Task the bridge creates; check the 360 SMS App; `WhatsApp_Incoming_Message_Handler` filter |
| Two run-log rows for one automation, one stuck QUEUED | Known gap: the async ack id differs from the run id | Ignore the QUEUED row; fixed by requirement R1.1 |
| `McpRateLimited` / 429 from a connector | Tool-list rate limit; the server backs off 60 s and serves stale lists | Wait; if persistent, check the connector's logs |
| A build stopped at "paused" | Cost ceiling reached | Resume with more budget from the build card or the copilot (`resume_build`) |
| Everything slow (8–11 s turns) | Caches expired after a sleep; Postgres round trips at ~465 ms each | Normal for the first turn after a wake; if persistent, read `PhaseMsJson__c` and look at `resolveServers` and `servers.awake` |
| Postgres down | `/health` 500s; turns fail; installs are served stale for 10 minutes | Render database status; nothing in Salesforce is lost, chat approvals and run checkpoints are |

## 11. Data operations

- **Retention jobs:** trace sweep every 6 hours (only when the admin console is enabled, see requirement R1.7); expired tickets deleted on each mint; chat approvals expire lazily; orphaned builds and background rows failed at boot. There is no sweep yet for `PendingOAuth`, `ConnectionReminder`, `AgentRun`, `BackgroundToolRun` or `MobileSession` (requirement R1.8).
- **Salesforce side:** nothing is scheduled. `ChatSession__c.ExpiresAt__c` mentions a `ChatSessionExpirer` scheduled job that does not exist in the code base; sessions past expiry are not marked Expired automatically.
- **Test data:** `node scripts/comm-tests/run.mjs cleanup` deletes the `[ARCHON TEST]` fixtures and records the harness created; the revival evals clean up after themselves.
- **Deleting a tenant:** Setup → Reset removes the install; `Connector` rows and KB rows remain and must be deleted by hand today; the public `/data-deletion` page gives the contact address.
- **Backups:** Render Postgres snapshots **to confirm** in the dashboard; Salesforce data is under the customer's own backup.

## 12. Scheduled and boot work

| Job | Where | Interval | Does |
|---|---|---|---|
| Run poller | server | 15 s, plus one sweep at boot | Resumes due waits; auto-rejects overdue approvals; writes results back |
| Handoff poller | server | 60 s, plus boot | Returns handed-off sessions whose quiet period passed |
| Trace retention | server | 6 h, 30 s after boot | Purges payloads after 14 days and rows after 90 |
| Boot sweeps | server | at start | Fails orphaned background runs (Tasks and notes) and orphaned builds; warns if `ENCRYPTION_KEY` is unset |
| Ticket cleanup | server | on each mint | Deletes expired WebSocket tickets |

## 13. Limits to keep in mind

Twenty socket messages per minute per connection. A ticket lives 45 seconds and works once. A turn is capped at 80k tokens, 90 seconds (540 on the socket) and 24 steps by default. A chat approval expires after 24 hours. A build stops at $4 unless raised. The walker runs at most 100 nodes per burst and 100 loop iterations. One server instance only, until requirement R1.9 lands. The free tier sleeps after about 15 minutes idle, and so do the connector hosts.

## Appendix. Script map

| Script | Purpose |
|---|---|
| `scripts/page-shot.cjs`, `node-shot.cjs`, `runs-shot.cjs`, `viewport-check.cjs` | Screenshots of the deployed app, a node form, the runs page, viewport checks |
| `scripts/identity-ui-check.cjs`, `chat-approval-check.cjs` | Browser checks for identity screens and chat approvals |
| `scripts/ws-turn.mjs`, `server-langchain/ws-stream-turn.mjs` | A real WebSocket turn from the command line |
| `scripts/comm-tests/run.mjs` | Build, score, chat, report, cleanup for the six communication cases |
| `scripts/evals/run-evals.mjs` | Scripted WhatsApp conversations against the revival agent |
| `scripts/apex/real/*.apex` | Anonymous Apex: mint a ticket, measure a build, exercise a handoff, refresh the Metadata Expert, flip background flags |
| `scripts/build-package-source.py` | Generate `ArchonPackage/` from `force-app` |
| `server-langchain/scripts/*.ts` | Offline verifications (architect, replay, trace redaction, prerequisites) and `backfill-secrets.ts` |
| `server-langchain/scripts/architect-compile-test.ts` | Compiler invariants against the real org, no model calls |
