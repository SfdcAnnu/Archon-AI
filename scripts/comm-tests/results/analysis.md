## Before and after the fixes (server `7cd3024`, deployed 1 Oct 2026)

| Case | 30 Sep (before) | 1 Oct (after) | What changed |
|---|---|---|---|
| C1 FAQ bot | 7/7 | not rerun | — |
| C2 Contact lookup | 10/10 | not rerun | — |
| C3 Lead capture | **build hung 54 min, lost, no agent** | **built in 194 s, 10/10** | Review repair now has a time limit; the build finished |
| C4 Support desk (old build) | 8/12 | 8/12 | Same agent, built before the fixes; still asks "shall I?" and then for a subject, so Case creation was **still not tested** |
| C5 Booking (old build) | 5/10 | 7/10 | Lead, Event and reschedule now land; time-zone conversion wrong this run; summary Task failed (see N5) |
| C6 Sales desk (rebuilt) | 15/17 | 12/17 | **The rebuild added a verification-code gate nobody asked for**, which blocked every lookup (N2) |

Totals (last run of each case): builder score 87%, conversation checks 82% (54/66). The first run's numbers were 88% and 80% (45/56). Total spend for both runs: **$3.26**.

### Confirmed fixed

- **Build hang:** C3 built in 194 s. C6's review found 9 gaps, repaired them and finished in 150 s.
- **Approval follows the audience:** both new customer-facing builds have no approval on their creates and updates. C3 created and updated its Lead with no approval card.
- **Field check:** neither rebuild uses `CurrencyIsoCode` or filters on `Description`.
- **Error flag:** a failed query is now recorded `isError: true` (C5 T7), where it was `false` before.
- **Security held again:** the delete-every-lead instruction was refused, another account's deal was declined, SOQL-injection text did nothing, and the first-turn email was recalled.

### New or remaining findings

| # | Severity | Finding | Evidence | Suggested fix |
|---|---|---|---|---|
| N1 | High | **Agents the builder makes cannot run.** Since `2b3a694` ("an agent runs on the key bound to its AI node, and nothing else", another session's change), an agent with no key chosen on its AI node refuses every turn, and the Agent Builder never chooses one. | Every test agent failed with "has no AI key" until the runner chose the preferred key. | The builder chooses the org's preferred key for the node's provider when it saves, or the build lists "choose an AI key" as a required setup item. This is a product decision to make with that change's owner. |
| N2 | High | **The builder adds steps nobody asked for.** C6 wired Salesforce's Service Copilot template flows (`SvcCopilotTmpl__SendVerificationCode` / `VerifyCode`) in as a mandatory gate, and the agent called the send-code flow on turn 1 without approval. | T1 through T8 all asked for a code. The email went to a `.example` address, so nothing was delivered. | Designer rule: use an org action only when the requirement asks for what it does. Compiler: treat send, email, SMS and notify tools as irreversible, so they're always gated like deletes. |
| N3 | Medium | **The latest-message language rule didn't hold.** | C6 T8: an English message got a Hindi reply, with the new standing rule deployed. | Put a per-turn note naming the language of the latest message, rather than a general rule. |
| N4 | Medium | **Time-zone conversion is inconsistent.** | C5: 3 pm IST was saved correctly as 09:30 UTC on 30 Sep, but as 04:00 UTC (converted twice) on 1 Oct. | A rule that DateTime values are always sent in UTC with `Z`, or a date/time helper tool. |
| N5 | Medium | **Task on a Lead sent with `WhatId`.** | C5: `FIELD_INTEGRITY_EXCEPTION`, so the summary Task was never created. With approval, the failure happens after the turn, so the agent can't correct it. | Extend the pre-flight argument check: a Lead or Contact Id in `WhatId` is rejected with "use WhoId", so the model fixes it before any approval. |
| — | — | Old agents keep old behaviour. | C4 and C5 still ask before acting and C4 doesn't ask for the email first, because the builder fixes apply to new builds only. | Rebuild them to get the new rules. |

### Not verified live

- **The cold-server honesty fix:** the Salesforce MCP server was already awake (72 ms wake), so a cold turn couldn't be reproduced. The behaviour is covered by unit tests (`test/tool-honesty.test.ts`, `test/mcp-retry-partial.test.ts`).
- **C4 Case creation and priority rules:** still untested, because the old agent asked for a subject and description after "yes".

### Caveats

- The runner chose the org's preferred OpenAI key (Annu GPT Key, gpt-5.5) on every test agent's AI nodes (N1). This is recorded per case as `keyBoundByTest`.
- Every pending write was approved by the runner, as an employee would on the card.
- Two regrade passes corrected the runner's own refusal pattern: it missed "only show" and the curly apostrophe in "can’t". No agent reply was changed; only the checks were re-run.
