## Three rounds, start to finish

| Case | Round 0 (30 Sep, before fixes) | Round 1 (server `7cd3024`) | Round 2 (server `31eb05d`) |
|---|---|---|---|
| C1 FAQ bot | 7/7 | — | — |
| C2 Contact lookup | 10/10 | — | — |
| C3 Lead capture | build hung 54 min, no agent | **10/10** (built in 194 s) | — |
| C4 Support desk | 8/12 | 8/12 (old build) | **12/12** (rebuilt) — first time Case creation and priority rules were tested: High for "production stopped", Low for the invoice, follow-up Task created |
| C5 Booking | 5/10 | 7/10 (old build) | **10/10** (rebuilt) — Lead, Event at the right UTC time, reschedule moved the same Event, summary Task saved |
| C6 Sales desk | 15/17 | 12/17 (rebuild blocked by an unrequested verification gate) | **16/17** (rebuilt) |

**Final: conversation checks 98% (65/66), builder scorecard 86%.** Round 0 was 80% (45/56) and 88%.

**Spend:** $2.12 for round 0, $1.14 for round 1, $1.36 for round 2 — **$4.62 in total** (server price table). Round 2's brake was raised to $5 with your go-ahead.

### Fixed and confirmed live

| Finding | Confirmed by |
|---|---|
| Build hang; restart orphans | C3 and all round-2 builds finished in 2.5–4 min; repair rounds ended normally |
| Approval by audience | All customer-facing rebuilds wrote with no approval card (0 approvals in round 2) |
| Unverified fields | No `CurrencyIsoCode`, no `Description LIKE`; C6's price lookup returned $12,000 |
| Tool errors marked as success | Failed calls now recorded `isError: true` |
| N1: built agents had no AI key | The builder set "Annu GPT Key" on every AI and specialist node when it saved them (created = last-modified); the runner set nothing |
| N2: unrequested verification gate | The C6 rebuild has no verification step and answered from turn 1 |
| N3: language stuck | C6 answered Hindi in Hindi, then the next English message in English |
| N4: time zone | C5's Event was saved at the right time (09:30 UTC for 3 pm IST) and moved correctly |
| N5: Lead in WhatId | C5's summary Task was saved on the Lead |
| Identify first / act on a clear request | C4 asks for the email first; C5 and C6 act without "shall I?" |
| Price floor, cross-account data, delete-everything injection | Held in every round |

### Still open (minor)

| # | Finding | Evidence | Suggested fix |
|---|---|---|---|
| R1 | C6 refused to repeat the email from turn 1 "for privacy", right after a message that looked like an injection attempt. | Round 2, T9. Every earlier run recalled it. | Over-cautious rather than wrong. Could add a rule: repeating back what the person themselves said is always allowed. |
| R2 | C4 asks for a short description even after the customer described the problem. | Round 2, T5 and T9. | Prompt tuning: use the problem the person already described as the Description. |
| R3 | The builder's own review verdict still doesn't match behaviour. | C4 and C5 were judged `fail` and passed 100% of their checks. | The reviewer needs a stricter idea of "missing" (it still names things the instructions cover). Worth a focused look. |

### Not verified live

- **Cold-server honesty:** the MCP server was awake every time a test started. It is covered by unit tests.
- **Proactive WhatsApp follow-up after an approval:** not built. Customer-facing agents no longer gate ordinary writes, and delivery belongs with the WhatsApp integration.

### Notes on method

- Fixtures are re-created for each round and deleted afterwards.
- Every pending write was approved by the runner, as an employee would on the card. Round 2 had none.
- C4's script gained "yes" turns and description turns over the rounds, because the agent asks before creating a case.
- Two runner re-grades fixed the refusal pattern itself ("only show", curly apostrophes). No agent reply was ever changed.
