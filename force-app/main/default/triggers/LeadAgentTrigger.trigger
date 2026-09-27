/**
 * Sample trigger — wires new Leads into the Archon AI engine.
 * Customers can disable, modify the agent api name, or replicate
 * this pattern for any SObject.
 */
trigger LeadAgentTrigger on Lead (after insert) {
    LeadAgentTriggerHandler.handleAfterInsert(Trigger.new);
}
