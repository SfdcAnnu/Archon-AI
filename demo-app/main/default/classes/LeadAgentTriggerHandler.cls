/**
 * LeadAgentTriggerHandler — sample trigger handler that fires AgentRunner
 * for newly-created Leads.
 *
 * THIS IS A SAMPLE. Customers can customize:
 *   - which agent to run (currently 'lead_qualifier')
 *   - which records to route (currently all new Leads)
 *   - run mode (sync vs async — async recommended for production)
 *
 * Note: Lead is a standard object, so this trigger ships as a sample.
 *       In a managed package, customers attach their own triggers to
 *       AgentRunner.run(...) — engine never assumes a specific SObject.
 */
public with sharing class LeadAgentTriggerHandler {

    private static final String DEFAULT_AGENT = 'lead_qualifier';

    public static void handleAfterInsert(List<Lead> newLeads) {
        if (newLeads == null || newLeads.isEmpty()) return;

        List<AgentRunner.AgentInput> inputs = new List<AgentRunner.AgentInput>();
        for (Lead l : newLeads) {
            AgentRunner.AgentInput inp = new AgentRunner.AgentInput();
            inp.agentApiName = DEFAULT_AGENT;
            inp.recordId     = l.Id;
            inp.runMode      = 'async';   // don't block the DML transaction
            inp.inputPayload = JSON.serialize(new Map<String, Object>{
                'Email'   => l.Email,
                'Company' => l.Company,
                'Status'  => l.Status,
                'Country' => l.Country,
                'Industry' => l.Industry
            });
            inputs.add(inp);
        }

        // Callouts can't fire inside a trigger context synchronously — async only.
        // Push to a queueable to make the callout safely after commit.
        System.enqueueJob(new LeadAgentQueueable(inputs));
    }

    /**
     * Queueable wrapper — allows callouts (Database.AllowsCallouts) from a
     * trigger-initiated context.
     */
    public class LeadAgentQueueable implements Queueable, Database.AllowsCallouts {
        private final List<AgentRunner.AgentInput> inputs;

        public LeadAgentQueueable(List<AgentRunner.AgentInput> inputs) {
            this.inputs = inputs;
        }

        public void execute(QueueableContext qc) {
            AgentRunner.run(inputs);
        }
    }
}
