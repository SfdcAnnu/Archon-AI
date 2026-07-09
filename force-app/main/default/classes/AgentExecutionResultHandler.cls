/**
 * AgentExecutionResultHandler — upserts AgentExecution__c records when
 * the Node.js server publishes AgentExecutionResult__e Platform Events.
 *
 * Uses CorrelationId__c as the external id so the upsert matches existing
 * queued records (created at request time) or creates new ones if none exist.
 */
public with sharing class AgentExecutionResultHandler {

    public static void processResults(List<AgentExecutionResult__e> events) {
        if (events == null || events.isEmpty()) return;

        // Map ApiName → AgentDefinition__c.Id for one bulk lookup
        Set<String> apiNames = new Set<String>();
        for (AgentExecutionResult__e ev : events) apiNames.add(ev.AgentApiName__c);

        Map<String, Id> agentIdByApi = new Map<String, Id>();
        for (AgentDefinition__c a : [
            SELECT Id, ApiName__c FROM AgentDefinition__c
            WHERE ApiName__c IN :apiNames
            WITH USER_MODE
        ]) {
            agentIdByApi.put(a.ApiName__c, a.Id);
        }

        List<AgentExecution__c> toUpsert = new List<AgentExecution__c>();
        for (AgentExecutionResult__e ev : events) {
            AgentExecution__c rec = new AgentExecution__c(
                CorrelationId__c   = ev.CorrelationId__c,
                AgentDefinition__c = agentIdByApi.get(ev.AgentApiName__c),
                RecordId__c        = ev.RecordId__c,
                Status__c          = ev.Status__c,
                AgentScore__c      = ev.AgentScore__c,
                AgentPriority__c   = ev.AgentPriority__c,
                AgentReason__c     = ev.AgentReason__c,
                ToolsUsed__c       = ev.ToolsUsed__c,
                OutputPayload__c   = ev.OutputPayload__c,
                ExecutionMs__c     = ev.ExecutionMs__c
            );
            toUpsert.add(rec);
        }

        if (!toUpsert.isEmpty()) {
            // Upsert by external ID — CorrelationId__c is unique on AgentExecution__c
            upsert toUpsert CorrelationId__c;
        }
    }
}
