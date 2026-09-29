/**
 * An automation could not run for a person because they have no identity
 * for a connector: remind them, off the run's own transaction.
 */
public with sharing class ConnectionReminderQueueable implements Queueable, Database.AllowsCallouts {
    private final String providerKey;
    private final Id userId;
    private final String agentApiName;

    public ConnectionReminderQueueable(String providerKey, Id userId, String agentApiName) {
        this.providerKey = providerKey;
        this.userId = userId;
        this.agentApiName = agentApiName;
    }

    public void execute(QueueableContext qc) {
        ConnectionReminderService.send(providerKey, new List<Id>{ userId }, agentApiName);
    }

    /**
     * The marker a failed run carries: "NEEDS_CONNECTION:<provider>:<userId> — …".
     * Enqueues one reminder per run; a run for a user who already has one
     * pending in this transaction is not reminded twice.
     */
    public static void remindFromReason(String reason, String agentApiName) {
        if (String.isBlank(reason) || !reason.startsWith('NEEDS_CONNECTION:')) return;
        if (Test.isRunningTest() || Limits.getQueueableJobs() >= Limits.getLimitQueueableJobs()) return;
        List<String> parts = reason.substringBefore(' ').split(':');
        if (parts.size() < 3) return;
        String providerKey = parts[1];
        Id userId;
        try { userId = (Id) parts[2]; } catch (Exception e) { return; }
        System.enqueueJob(new ConnectionReminderQueueable(providerKey, userId, agentApiName));
    }
}
