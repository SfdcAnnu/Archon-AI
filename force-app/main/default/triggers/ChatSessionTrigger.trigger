/**
 * A conversation handed to a person, or given back to the agent, is a
 * status change on ChatSession__c. The handler turns each change into the
 * transcript line, the notification and the customer's line, whichever
 * path made the change (the agent's tool, the Return button, /agent, the
 * quiet-period sweep).
 */
trigger ChatSessionTrigger on ChatSession__c (after update) {
    ChatSessionHandoffHandler.afterUpdate(Trigger.new, Trigger.oldMap);
}
