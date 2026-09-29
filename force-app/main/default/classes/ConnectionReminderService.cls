/**
 * Reminders to connect an account: an email and a Salesforce notification
 * to each person, deep-linked to their My connections page with the
 * provider highlighted, and a record on the Archon server so the roster
 * shows "reminded 29 Sep · 1 of 3".
 *
 * Sent by an admin from the roster, or after an automation could not run
 * for someone (AgentRunner → ConnectionReminderQueueable). The server's
 * record goes first: a callout may not follow email or DML in a transaction.
 */
public with sharing class ConnectionReminderService {

    public static Integer send(String providerKey, List<Id> userIds, String agentApiName) {
        if (userIds == null || userIds.isEmpty()) return 0;
        String providerLabel = labelOf(providerKey);
        String agentName = agentApiName;
        if (String.isNotBlank(agentApiName)) {
            List<AgentDefinition__c> a = [SELECT Name FROM AgentDefinition__c WHERE ApiName__c = :agentApiName LIMIT 1];
            if (!a.isEmpty()) agentName = a[0].Name;
        }
        List<User> people = [SELECT Id, Name, Email FROM User WHERE Id IN :userIds AND IsActive = true];
        if (people.isEmpty()) return 0;

        // 1. Record on the server (callout first).
        List<String> ids = new List<String>();
        for (User u : people) ids.add(u.Id);
        try {
            ArchonServerClient.callout('POST', '/api/connectors/reminders', JSON.serialize(new Map<String, Object>{
                'providerKey' => providerKey, 'userIds' => ids, 'agentApiName' => agentApiName, 'channel' => 'email+notification'
            }));
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'ConnectionReminderService: could not record on the server: ' + e.getMessage());
        }

        String link = appUrl() + '/my-connections#connect-' + providerKey;
        String subject = 'Connect your ' + providerLabel + (String.isNotBlank(agentName) ? ' so ' + agentName + ' can work for you' : ' for Archon');

        // 2. Email.
        List<Messaging.SingleEmailMessage> mails = new List<Messaging.SingleEmailMessage>();
        for (User u : people) {
            if (String.isBlank(u.Email)) continue;
            Messaging.SingleEmailMessage m = new Messaging.SingleEmailMessage();
            m.setTargetObjectId(u.Id);
            m.setSaveAsActivity(false);
            m.setSubject(subject);
            String body = 'Hi ' + u.Name.substringBefore(' ') + ',\n\n'
                + (String.isNotBlank(agentName)
                    ? agentName + ' works as you and needs your ' + providerLabel + ' account. It could not run for you until you connect it.'
                    : 'An Archon agent needs your ' + providerLabel + ' account to work as you.')
                + '\n\nIt takes one sign-in:\n' + link + '\n\nOnly you can see what you connect; you can disconnect any time from My connections.\n\n— Archon';
            m.setPlainTextBody(body);
            m.setHtmlBody(body.replace('\n', '<br>').replace(link, '<a href="' + link + '">Connect my ' + providerLabel + '</a>'));
            mails.add(m);
        }
        Integer sent = 0;
        if (!mails.isEmpty()) {
            try {
                for (Messaging.SendEmailResult r : Messaging.sendEmail(mails, false)) if (r.isSuccess()) sent++;
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, 'ConnectionReminderService: email failed: ' + e.getMessage());
            }
        }

        // 3. Salesforce notification (bell), when the type is deployed.
        try {
            List<CustomNotificationType> types = [SELECT Id FROM CustomNotificationType WHERE DeveloperName = 'Archon_Connection_Reminder' LIMIT 1];
            if (!types.isEmpty()) {
                for (User u : people) {
                    Messaging.CustomNotification n = new Messaging.CustomNotification();
                    n.setTitle(subject.left(250));
                    n.setBody(('Connect it once from My connections: ' + link).left(750));
                    n.setNotificationTypeId(types[0].Id);
                    n.setTargetId(u.Id);
                    n.send(new Set<String>{ u.Id });
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'ConnectionReminderService: notification failed: ' + e.getMessage());
        }
        return Math.max(sent, people.size());
    }

    /** The provider's display name from the catalog, else its key. */
    public static String labelOf(String providerKey) {
        List<ConnectorCatalog__mdt> rows = [SELECT DisplayName__c FROM ConnectorCatalog__mdt WHERE DeveloperName = :providerKey LIMIT 1];
        return rows.isEmpty() || String.isBlank(rows[0].DisplayName__c) ? providerKey : rows[0].DisplayName__c;
    }

    /**
     * Where the Agent Builder app lives for this org. A UI Bundle app is
     * served from the org's own *.my.salesforce.app domain:
     *   acme.my.salesforce.com            → https://acme--c.my.salesforce.app/app/c__Agent_Builder
     *   x-dev-ed.develop.my.salesforce.com → https://x-dev-ed--c.develop.my.salesforce.app/app/c__Agent_Builder
     */
    public static String appUrl() {
        String host = URL.getOrgDomainUrl().getHost();
        Integer dot = host.indexOf('.');
        if (dot < 0) return URL.getOrgDomainUrl().toExternalForm();
        String first = host.substring(0, dot);
        String rest = host.substring(dot).replace('.my.salesforce.com', '.my.salesforce.app');
        return 'https://' + first + '--c' + rest + '/app/c__Agent_Builder';
    }
}
