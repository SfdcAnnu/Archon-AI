# Archon AI — Configuration Guide

Audience: the person setting up Archon in a Salesforce org for the first time (admin/dev). This is a one-time, per-org setup. Once done, individual builders use the [USER_GUIDE.md](./USER_GUIDE.md).

Last generated: 2026-07-24, from a direct read of the deployed metadata and server source — not from memory or older design docs. If something here disagrees with `server/README.md` or `server/.env.example`, **trust this document**: those two files still describe a JWT-based auth scheme that was replaced by session-key auth (`sessionAuth` middleware) and never updated. There is no `auth/jwt.ts` in the server and `config.ts` reads no JWT variables — ignore any JWT instructions you find elsewhere in the repo.

> **Updated same day, later pass — fixes from hands-on testing feedback:**
> - Permission sets: 2 now, not 4 (section 6 below rewritten).
> - **Archon Setup** is now a proper app tab with two sub-tabs: Salesforce Setup (unchanged OAuth flow) and a new **AI Provider Setup** tab — add/edit/delete/test AI Engine Connections from one page instead of only from inside an AI node's config panel.
> - **Archon Chat** is now a proper app tab too (was App-Launcher-only before).
> - No more shared/default AI provider key: every AI node and the KB's embeddings both require a real `AiEngineConnection__c` — there's no `.env` fallback on the server anymore. If you were relying on a shared dev key for testing, agents will now fail clearly until you add a connection under AI Provider Setup.
> - Connectors directory now supports adding a **custom MCP server** (any URL) alongside the packaged catalog — see section 7a below.

---

## 1. Architecture at a glance

Archon is two deployables that must both be running and pointed at each other:

- **Salesforce app** (`force-app/`) — the Builder canvas, chat UI, and all Apex controllers. Every Apex controller that talks to the outside world goes through `ArchonServerClient.callout(...)`.
- **Archon Server** (`server/`) — a Node service (deployed to Render in this project) holding the flow-graph execution engine, the RAG knowledge-base pipeline, AI provider calls (Claude/OpenAI/Gemini), OAuth token storage for connected providers, and Postgres (via Prisma) for everything that doesn't belong in Salesforce.

Multi-tenancy: every org that authorizes gets one row in `SynapseInstall__c` (Salesforce side) holding a **session key**, and a matching org record server-side. That session key is the only credential Apex sends on every callout (`Bearer <sessionKey>`) — there is no separate JWT step.

---

## 2. Prerequisites

- A Salesforce org (sandbox or dev org is fine) with My Domain enabled.
- The Archon Server already deployed and reachable at some base URL (e.g. `https://archon-server.onrender.com`). This guide assumes the server is already running; deploying the Node server itself is out of scope here.
- `sf` CLI authenticated against the target org.

---

## 3. Deploy the metadata

```
sf project deploy start --source-dir force-app
```

**Known gotcha — deploy in two passes if you've just pulled new custom fields.** `AgentDefinition__c` (and a few other objects) use SFDX's decomposed-fields format (`objects/<Object>/fields/*.field-meta.xml`). Once an object has *any* field decomposed this way, Salesforce silently ignores field blocks left inline in the parent `.object-meta.xml` — the deploy reports `numberComponentErrors:0` but the field never actually gets created. If a deploy succeeds but a field genuinely doesn't exist in the org afterward, that's the cause — every field in this repo is already correctly split into its own file, but keep this in mind if you add new fields later. Relatedly, deploy new fields in their own `sf project deploy start` call before deploying Apex/permission sets that reference them if you hit "no such column" errors in the same batch.

---

## 4. Point the org at the Archon Server

**Setup → Custom Metadata Types → Synapse Config → Manage Records → Default → Edit.**

| Field | Value | Notes |
|---|---|---|
| `ServerUrl__c` | e.g. `https://archon-server.onrender.com` | **Required.** Every Apex controller (`ArchonServerClient`, `AgentConnectorController`, `AgentChatController`, `AiEngineConnectionController`, `AgentUserConnectionController`, `SynapseSetupController`) reads this one field to know where to call. If it's blank you'll see `"...ServerUrl__c is not set"` errors everywhere. |
| `JwtSecret__c` | leave blank | **Dead field.** Grep confirms nothing in the current Apex codebase reads it. It's a leftover from an earlier auth design; do not spend time populating it. |

## 5. Remote Site Setting

Confirm **Setup → Remote Site Settings → Synapse_Server** points at the same host as `ServerUrl__c` above (protocol + host, no trailing path). Apex callouts to any host not covered by a Remote Site Setting fail outright — this is the most common "why is nothing working" cause after a fresh deploy to a new org.

---

## 6. Assign permission sets

**Just two permission sets ship with the app** (as of this update — earlier builds had four; `ArchonAiEngineAdmin`/`ArchonAiEngineUser` were merged into the two below and removed):

| Permission set | Label | Who gets it | What it grants |
|---|---|---|---|
| `AgentBuilderUser` | **Archon Admin** | Anyone who configures the app or builds/edits agents | Full CRUD on `AgentDefinition__c`/`AgentNode__c`, every Builder Apex controller (Connector, KB, Generator, Approval, Sharing), Archon Setup (both Salesforce Setup and AI Provider Setup tabs), **org-wide/Shared AI Engine Connections**, custom MCP server management, the Builder LWCs. |
| `AgentChatUser` | **Archon Agent Invoker** | Everyone who only **runs/chats with** agents shared with them | Chat controllers/objects only (`ChatSession__c`, `ChatMessage__c`), decide approvals assigned to them, manage their **own personal** AI Engine Connections (not org-wide ones), read-only visibility of agent definitions they have sharing on. No build/share/config access.|

That's it — assign `AgentBuilderUser` to anyone who touches the builder or Setup; assign `AgentChatUser` to everyone else who just needs to chat with/run agents. A person can hold both if they need to build AND use their own personal key day-to-day.

---

## 7. Authorize the org (one-time OAuth handshake)

Go to the **Archon Setup** tab (`Synapse_Setup` — reachable via App Launcher; it's intentionally not one of the four tabs in the `Synapse_AI` app so it doesn't clutter day-to-day navigation) and click **Authorize**. What happens, per the page's own explainer:

1. You click **Authorize**.
2. You're redirected to Salesforce login → consent to the "Archon Agent Platform" connected app.
3. Salesforce sends the auth code to the Archon server.
4. The server exchanges it for access + refresh tokens and stores them server-side, keyed to this org.
5. You're redirected back with a one-time pickup token; the page exchanges that for a long-lived **session key**, written to `SynapseInstall__c.SessionKey__c` for this org (`SynapseInstall__c.ConfiguredByEmail__c`/`ConfiguredAt__c` record who/when).

After this succeeds, the **Salesforce MCP** connector tile in the Builder's Connectors directory automatically shows Connected — there's nothing further to configure for Salesforce itself as a tool source.

If you ever need to rotate credentials, use **Reset** then **Authorize** again — this invalidates the old session key.

---

## 8. AI Engine Connections (which AI actually answers)

**Navigate via the AI Engine picker in the Builder** (`aiEngineConnectionForm`/`aiEngineConnectionPicker` LWCs, backed by `AiEngineConnectionController`).

Each connection records:

| Field | Meaning |
|---|---|
| `EngineType__c` | `claude` (Anthropic) / `openai` (GPT) / `gemini` (Google) / `custom` (self-hosted, OpenAI-compatible endpoint) |
| `ApiKey__c` | the provider key |
| `DefaultModel__c`, `Endpoint__c` | optional overrides |
| `OwnershipType__c` | `Personal` — only the owner can use it — or `Shared` — admin-managed, usable org-wide |
| `IsActive__c`, `IsPreferred__c` | a user can hold several keys per engine; Preferred+Active is used first |
| `IsPublicShared__c` | grants read access to all users in the org (only meaningful alongside `OwnershipType__c = Shared`) |

**Resolution order when an AI node runs** (highest priority first):
1. The running user's own **Personal**, Preferred, Active connection for that engine type.
2. Any other Active Personal connection the user owns for that engine type.
3. A connection bound directly to the specific AI node in the Builder.
4. An org-wide **Shared** connection.
5. If none of the above exist, the server falls back to its own `.env` default key (useful for demos, not recommended for production multi-tenant use).

Set up at least one Shared connection per engine type you plan to use, so agents work for users who haven't configured a personal key. Individual users only need a Personal connection if you want their usage billed/tracked separately or if they need a model the shared key doesn't have access to.

---

## 9. Connect external providers (tools an agent can call)

**Builder → Connectors** (`agentConnectorsDirectory` LWC) lists every provider defined in **`ConnectorCatalog__mdt`**: `gmail`, `outlook`, `slack`, `teams`, `gdrive`, `onedrive`, `sharepoint`, `salesforce_mcp`. Each metadata record carries `AuthType__c`, `AuthorizeUrl__c`, `TokenUrl__c`, `Scopes__c`, `McpServerUrl__c`, plus display fields (`DisplayName__c`, `IconStaticResource__c`, `BrandColor__c`, `Category__c`).

To make a provider available:
1. Confirm its `ConnectorCatalog__mdt` record has correct OAuth URLs/scopes for your tenant (these ship pre-filled for the standard providers; only edit if you're pointing at a non-default OAuth app).
2. Have each user who needs that tool click **Connect** on the tile in the Connectors directory and complete the OAuth consent screen. Connections are per-user (`AgentUserConnectionController`), not shared automatically — this is deliberate, since most of these are personal mailboxes/drives.
3. Once connected, that provider becomes selectable as the `connectorId` on any **catalog node** (`salesforce_crm_tools`, `storage_tools`, `email_tools`, `channel_tools`) in the Builder.

Salesforce itself (`salesforce_mcp`) is the one exception — it's satisfied automatically by the org-level authorization in step 7, not a per-user connect.

---

## 10. Knowledge Base storage backend (per-agent RAG)

This is the answer to "where does a client's uploaded knowledge actually live" — deliberately **not** a single fixed choice. Each agent's Documents tab (Builder → open an agent → Knowledge base → Documents) lets the builder pick one of three backends, stored in `KbStorageConfig` (Node/Postgres side) per org:

| Option (`backend` value) | What it means | When to pick it |
|---|---|---|
| **Archon default (hosted for you)** (`archon`) | Documents and their vectors live in Archon's own Postgres, isolated per org. Fastest to set up — no config needed. | Default; fine unless the client has a specific data-residency requirement. |
| **Your own Postgres** (`external_pg`) | Bring your own Postgres with the `pgvector` extension. Content and vectors live entirely in the client's database, never touch Archon's. Requires a connection string, testable in-UI via **Test connection** before saving. | Security-conscious clients who want to own/audit the vector store, or who already run Postgres and want one place for everything. |
| **Your Salesforce org** (`salesforce`) | Content is written as `AgentKbChunk__c` records in the client's own org — it never leaves Salesforce at rest. Retrieval is keyword-based (SOSL), not true vector similarity — a real trade-off, not a lesser version of the same thing. | Clients whose compliance posture requires everything to stay inside Salesforce, and who can accept keyword-based (not semantic) retrieval. |

Note on the Salesforce-native backend: SOSL search indexing on a **brand-new** custom object can lag for a short period after the object is first created/deployed (`"entity type X does not support search"` errors are expected platform behavior during that window, not a bug — retry after a few minutes on a fresh org).

There is a fourth "storage" concept worth distinguishing: **Notes** (the agent's Notes tab) are plain text always injected in full on every call — good for short standing rules — versus **Documents**, which go through the chunk/embed/retrieve pipeline above and are pulled in by relevance. Explain this distinction to builders; it affects both cost and how much material an agent can practically hold.

---

## 11. Navigation summary

- **Synapse_AI** (Lightning app) — 4 tabs: Agent Home + the three raw object tabs (`AgentDefinition__c`, `AgentExecution__c`, `AgentNode__c`). This is what you assign to most users.
- **Synapse_Chat**, **Synapse_Setup** — exist as tabs but are deliberately left out of the app's tab bar; reach them via the App Launcher, or add them to specific users'/profiles' visible tabs if you want them front-and-center.

---

## 12. Troubleshooting

- **"SERVER_WAKING" errors / a raw HTML page instead of a friendly error.** The Archon Server's free-tier Render instance sleeps when idle; the first request after a while wakes it (~30–60s) and Render's edge answers with an HTML "Application loading" page in the interim. Every controller that calls the server (`AgentConnectorController`, `AgentKbController`, `AgentGeneratorController`) detects this and raises a `SERVER_WAKING`-prefixed error instead of surfacing raw HTML, and the corresponding LWCs auto-retry with backoff (up to 8 attempts, 8s apart). If you see this constantly (not just after idle periods), it means the server is undersized/crashing — check Render logs, not Salesforce.
- **Field "exists" per a successful deploy but queries say it doesn't.** See the decomposed-fields gotcha in section 3.
- **"You cannot deploy to a required field" on a permission set deploy.** Remove explicit `fieldPermissions` entries for fields marked `required="true"` in their field-meta — required fields are implicitly granted and Salesforce rejects an explicit grant.
