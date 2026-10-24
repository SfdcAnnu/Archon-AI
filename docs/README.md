# Archon documentation set

The enterprise document chain for Archon, written from the code and the decisions on record on 24 October 2026. Each document traces back to the one before it. Diagrams are Mermaid and render on GitHub; each document is also published as a page for review.

| # | Document | Status | Answers |
|---|---|---|---|
| 00 | [Business case and project charter](00-business-case-and-charter.md) | Draft 0.1, approved by the sponsor; numbers marked [sponsor] still open | Why Archon exists, for whom, what is in and out of scope, the risks, the decisions the sponsor owns |
| 01 | [Solution architecture](01-solution-architecture.md) | Draft 0.1 | What the pieces are, where data lives, how the nine key flows move, security, deployment, 21 known gaps, decisions |
| 02 | [Product requirements, next release](02-product-requirements-next-release.md) | Draft 0.1 | Twelve epics in the agreed order, each requirement with priority and acceptance criteria, the decisions the sponsor owns, traceability |
| 03 | [Data dictionary](03-data-dictionary.md) | Draft 0.1, field tables generated from the metadata | Every Salesforce object and Postgres table, who writes and reads each, JSON shapes, caches, classification and retention |
| 04 | [Test strategy](04-test-strategy.md) | Draft 0.1 | Six test levels with today's counts, coverage by area, thin spots, policies, a test per requirement, the release gate |
| 05 | [Deployment and operations runbook](05-deployment-and-operations-runbook.md) | Draft 0.1 | Systems, releasing, rollback, configuration, onboarding an org, secrets, monitoring, incident playbooks |

Regenerating the field tables in 03: the generator and page builder live in the authoring session's tool folder (`gen-fields.py`, `splice.py`, `build-doc.cjs`); they read `force-app/main/default/objects` and `server-langchain/prisma/schema.prisma`. Rerun them after a schema change and replace the tables.

## Older documents in this folder

`CHAT_AGENT_ARCHITECTURE.md` (June 2026), `CONFIGURATION_GUIDE.md`, `USER_GUIDE.md`, `TEST_PLAN.md`, `COMPREHENSIVE_TEST_REQUIREMENT.md` (July 2026) and `Synapse-AI-Project-Brief.html` describe the product before the LangChain server, the Architect, identity, handoff and background tools. They are kept for history and are superseded by the numbered set (requirement R10.2 moves them to an archive folder). `RevivalAgent-FAQ.md` is a knowledge-document template for one demo agent.
