/**
 * AgentGuardrailsController — org-wide chat token cap.
 *
 * `without sharing` deliberately: ChatSession__c's sharing model is Private,
 * so a `with sharing` aggregate would only total the RUNNING user's own
 * messages, not the whole org's — silently wrong for what's meant to be an
 * org-wide guardrail. The only thing this class exposes is a numeric total
 * (never message content), so bypassing sharing here is narrow and safe.
 */
public without sharing class AgentGuardrailsController {

    @AuraEnabled(cacheable=true)
    public static GuardrailsStatus getGuardrails() {
        AgentGuardrails__c row = AgentGuardrails__c.getOrgDefaults();
        GuardrailsStatus s = new GuardrailsStatus();
        s.isEnabled           = row != null && row.IsEnabled__c == true;
        s.maxTokensPerDay     = row != null ? row.MaxTokensPerDay__c   : null;
        s.maxTokensPerMonth   = row != null ? row.MaxTokensPerMonth__c : null;
        UsageTotals usage     = computeUsage();
        s.tokensUsedToday     = usage.today;
        s.tokensUsedThisMonth = usage.month;
        return s;
    }

    @AuraEnabled
    public static GuardrailsStatus saveGuardrails(Boolean isEnabled, Decimal maxTokensPerDay, Decimal maxTokensPerMonth) {
        AgentGuardrails__c row = AgentGuardrails__c.getOrgDefaults();
        if (row == null || row.Id == null) {
            row = new AgentGuardrails__c(SetupOwnerId = UserInfo.getOrganizationId());
        }
        row.IsEnabled__c         = isEnabled == true;
        row.MaxTokensPerDay__c   = maxTokensPerDay;
        row.MaxTokensPerMonth__c = maxTokensPerMonth;
        upsert row;
        return getGuardrails();
    }

    /**
     * Called by AgentChatController.sendTurn BEFORE the callout to the Node
     * server — a real hard stop, not advisory. Throws once the org has
     * already used up its day/month budget; never tries to predict what
     * the NEXT turn would cost (token usage is only known after a call
     * returns), so this blocks new turns once the cap is already crossed
     * rather than pre-emptively estimating.
     */
    public static void enforceBeforeTurn() {
        AgentGuardrails__c row = AgentGuardrails__c.getOrgDefaults();
        if (row == null || row.IsEnabled__c != true) return;

        UsageTotals usage = computeUsage();
        if (row.MaxTokensPerDay__c != null && usage.today >= row.MaxTokensPerDay__c) {
            throw new AuraHandledException(
                'Daily AI usage guardrail reached (' + usage.today.intValue() + ' / ' + row.MaxTokensPerDay__c.intValue() +
                ' tokens used today across all agents). Contact your admin, or try again tomorrow.'
            );
        }
        if (row.MaxTokensPerMonth__c != null && usage.month >= row.MaxTokensPerMonth__c) {
            throw new AuraHandledException(
                'Monthly AI usage guardrail reached (' + usage.month.intValue() + ' / ' + row.MaxTokensPerMonth__c.intValue() +
                ' tokens used this month across all agents). Contact your admin.'
            );
        }
    }

    // ── Internals ────────────────────────────────────────────────────

    private static UsageTotals computeUsage() {
        Date todayGmt = DateTime.now().dateGmt();
        DateTime startOfDayGmt   = DateTime.newInstanceGmt(todayGmt, Time.newInstance(0, 0, 0, 0));
        DateTime startOfMonthGmt = DateTime.newInstanceGmt(Date.newInstance(todayGmt.year(), todayGmt.month(), 1), Time.newInstance(0, 0, 0, 0));

        UsageTotals u = new UsageTotals();
        u.today = sumTokensSince(startOfDayGmt);
        u.month = sumTokensSince(startOfMonthGmt);
        return u;
    }

    /** Chat-mode only — tokens are only tracked on ChatMessage__c today, not on automation/trigger runs. */
    private static Decimal sumTokensSince(DateTime sinceGmt) {
        AggregateResult[] results = [
            SELECT SUM(TokensIn__c) tIn, SUM(TokensOut__c) tOut
            FROM ChatMessage__c
            WHERE Role__c = 'Assistant' AND CreatedDate >= :sinceGmt
        ];
        if (results.isEmpty()) return 0;
        Decimal tIn  = (Decimal) results[0].get('tIn');
        Decimal tOut = (Decimal) results[0].get('tOut');
        return (tIn == null ? 0 : tIn) + (tOut == null ? 0 : tOut);
    }

    private class UsageTotals {
        Decimal today = 0;
        Decimal month = 0;
    }

    public class GuardrailsStatus {
        @AuraEnabled public Boolean isEnabled;
        @AuraEnabled public Decimal maxTokensPerDay;
        @AuraEnabled public Decimal maxTokensPerMonth;
        @AuraEnabled public Decimal tokensUsedToday;
        @AuraEnabled public Decimal tokensUsedThisMonth;
    }
}
