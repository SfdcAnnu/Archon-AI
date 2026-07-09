/**
 * AgentExecutionResultTrigger — receives results from the Node.js server
 * for async runs and updates the matching AgentExecution__c records.
 *
 * Matched by CorrelationId__c (unique, external id).
 */
trigger AgentExecutionResultTrigger on AgentExecutionResult__e (after insert) {
    AgentExecutionResultHandler.processResults(Trigger.new);
}
