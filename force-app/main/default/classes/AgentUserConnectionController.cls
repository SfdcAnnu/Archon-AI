/**
 * Archon AI — SELF-SERVICE connections for chat users.
 *
 * Deliberately separate from AgentConnectorController (admin powers live
 * there; Apex class access is all-or-nothing, so chat users get ONLY this
 * class). Every method acts on the running user — a chat user can never
 * connect, inspect, or disconnect anyone else's account.
 *
 * Used by the chat panel's gate before the first message and by the
 * connect cards under a reply: what this person must connect for this
 * agent, and the sign-in link for their own account on any provider.
 */
public with sharing class AgentUserConnectionController {

    private static final Integer CALLOUT_TIMEOUT_MS = 60000;

    public class ConnectionGate {
        @AuraEnabled public String  accessMode;     // Org | PerUser
        @AuraEnabled public Boolean connected;      // personal connection present?
        @AuraEnabled public String  accountEmail;   // when connected
    }

    public class StartResult {
        @AuraEnabled public String authorizeUrl;
    }

    /**
     * What the RUNNING user must connect before this agent can act as them:
     * one entry per connector the agent runs as the user or their group,
     * with the person's status for it. Returned as the server's JSON —
     * { requirements: [{provider, displayName, runAs, required, status,
     *   accountEmail, message}], runsAsUser, ready, blocking }.
     */
    @AuraEnabled
    public static String getRequirements(String agentApiName) {
        if (String.isBlank(agentApiName)) throw failure('agentApiName is required.');
        HttpResponse res = callout('POST', '/api/connectors/requirements',
            JSON.serialize(new Map<String, Object>{ 'agentApiName' => agentApiName, 'userId' => UserInfo.getUserId() }));
        if (res.getStatusCode() >= 400) {
            throw failure('Could not read what this agent needs: ' + res.getBody());
        }
        return res.getBody();
    }

    /**
     * The RUNNING user's own connections across every provider, and which
     * active agents run as the person on each — the My connections page.
     * { providers: [{ providerKey, displayName, status, accountEmail,
     *   lastConnectedAt, connectionId, neededBy: [agent names] }] }
     */
    @AuraEnabled
    public static String getMyConnections() {
        // 1. Which providers active agents run as the person on.
        Map<String, List<String>> neededBy = new Map<String, List<String>>();
        for (AgentNode__c n : [
            SELECT AgentDefinition__r.Name, ConfigJson__c FROM AgentNode__c
            WHERE NodeType__c = 'catalog' AND IsEnabled__c = true AND AgentDefinition__r.Status__c = 'Active'
            WITH USER_MODE LIMIT 2000
        ]) {
            if (String.isBlank(n.ConfigJson__c)) continue;
            try {
                Map<String, Object> cfg = (Map<String, Object>) JSON.deserializeUntyped(n.ConfigJson__c);
                String provider = (String) cfg.get('provider');
                String runAs = (String) cfg.get('runAs');
                if (String.isBlank(provider) || runAs != 'user') continue;
                if (!neededBy.containsKey(provider)) neededBy.put(provider, new List<String>());
                if (!neededBy.get(provider).contains(n.AgentDefinition__r.Name)) neededBy.get(provider).add(n.AgentDefinition__r.Name);
            } catch (Exception e) { /* unreadable node */ }
        }
        for (AgentDefinition__c a : [SELECT Name FROM AgentDefinition__c WHERE AccessMode__c = 'PerUser' AND Status__c = 'Active' WITH USER_MODE LIMIT 500]) {
            if (!neededBy.containsKey('salesforce_mcp')) neededBy.put('salesforce_mcp', new List<String>());
            if (!neededBy.get('salesforce_mcp').contains(a.Name)) neededBy.get('salesforce_mcp').add(a.Name);
        }
        // 2. Display names from the catalog.
        Map<String, String> names = new Map<String, String>();
        for (ConnectorCatalog__mdt c : [SELECT DeveloperName, DisplayName__c FROM ConnectorCatalog__mdt]) names.put(c.DeveloperName, c.DisplayName__c);
        // 3. The person's rows on the server.
        Map<String, Map<String, Object>> mine = new Map<String, Map<String, Object>>();
        HttpResponse res = callout('POST', '/api/connectors/mine', JSON.serialize(new Map<String, Object>{ 'userId' => UserInfo.getUserId() }));
        Boolean serverUnreachable = res.getStatusCode() >= 400 || (res.getBody() != null && res.getBody().trim().startsWith('<'));
        if (!serverUnreachable) {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            for (Object o : (List<Object>) body.get('connections')) {
                Map<String, Object> c = (Map<String, Object>) o;
                String key = (String) c.get('providerKey');
                // The newest row per provider wins (the server orders by principal, then recency).
                if (!mine.containsKey(key) || (String) c.get('status') == 'Connected') mine.put(key, c);
            }
        }
        // 4. One line per provider: everything needed, plus anything connected.
        Set<String> keys = new Set<String>(neededBy.keySet());
        keys.addAll(mine.keySet());
        List<Map<String, Object>> providers = new List<Map<String, Object>>();
        for (String key : keys) {
            Map<String, Object> c = mine.get(key);
            providers.add(new Map<String, Object>{
                'providerKey'     => key,
                'displayName'     => names.containsKey(key) && String.isNotBlank(names.get(key)) ? names.get(key) : key,
                'status'          => c == null ? 'NotConnected' : (String) c.get('status'),
                'accountEmail'    => c == null ? null : c.get('accountEmail'),
                'lastConnectedAt' => c == null ? null : c.get('lastConnectedAt'),
                'lastErrorMessage'=> c == null ? null : c.get('lastErrorMessage'),
                'connectionId'    => c == null ? null : c.get('id'),
                'neededBy'        => neededBy.containsKey(key) ? neededBy.get(key) : new List<String>()
            });
        }
        return JSON.serialize(new Map<String, Object>{ 'providers' => providers, 'serverUnreachable' => serverUnreachable });
    }

    /** Disconnects one of the RUNNING user's own connections — the server
     *  refuses any row that is not theirs. */
    @AuraEnabled
    public static void disconnectMine(String connectionId) {
        if (String.isBlank(connectionId)) throw failure('connectionId is required.');
        HttpResponse res = callout('POST', '/api/connectors/mine/disconnect',
            JSON.serialize(new Map<String, Object>{ 'userId' => UserInfo.getUserId(), 'connectorId' => connectionId }));
        if (res.getStatusCode() >= 400) throw failure('Could not disconnect: ' + res.getBody());
    }

    /** Access mode of the agent + whether the RUNNING user has a personal
     *  Salesforce connection on the server. Kept for older bundles. */
    @AuraEnabled
    public static ConnectionGate getGate(String agentApiName) {
        ConnectionGate gate = new ConnectionGate();
        gate.accessMode = 'Org';
        gate.connected  = false;

        List<AgentDefinition__c> rows = [
            SELECT AccessMode__c FROM AgentDefinition__c
            WHERE ApiName__c = :agentApiName
            WITH USER_MODE LIMIT 1
        ];
        if (!rows.isEmpty() && String.isNotBlank(rows[0].AccessMode__c)) {
            gate.accessMode = rows[0].AccessMode__c;
        }
        if (gate.accessMode != 'PerUser') return gate;   // no server call needed

        HttpResponse res = callout('POST', '/api/connectors/my-status',
            JSON.serialize(new Map<String, Object>{
                'userId'      => UserInfo.getUserId(),
                'providerKey' => 'salesforce_mcp'
            }));
        if (res.getStatusCode() < 400) {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            gate.connected    = body.get('connected') == true;
            gate.accountEmail = (String) body.get('accountEmail');
        }
        return gate;
    }

    /** The RUNNING user's personal Salesforce connection (older bundles). */
    @AuraEnabled
    public static StartResult startMyConnection(String returnUrl) {
        return startMyConnectionFor(returnUrl, 'salesforce_mcp', 'Salesforce (my account)');
    }

    /**
     * Mints the OAuth authorize URL for the RUNNING user's own account on
     * any provider. The browser opens it; the server's callback stores the
     * tokens on this person's row — never on the org's.
     */
    @AuraEnabled
    public static StartResult startMyConnectionFor(String returnUrl, String providerKey, String displayName) {
        if (String.isBlank(providerKey)) throw failure('providerKey is required.');
        HttpResponse res = callout('POST', '/api/connectors/oauth/start',
            JSON.serialize(new Map<String, Object>{
                'providerKey'   => providerKey,
                'displayName'   => String.isBlank(displayName) ? providerKey + ' (my account)' : displayName,
                'returnUrl'     => returnUrl,
                'userId'        => UserInfo.getUserId(),
                'principalType' => 'user'
            }));
        if (res.getStatusCode() >= 400) {
            throw failure('Could not start the connection: ' + res.getBody());
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        StartResult out = new StartResult();
        out.authorizeUrl = (String) body.get('authorizeUrl');
        return out;
    }

    // ── Callout plumbing (mirrors AgentConnectorController, kept private
    //    here so chat users don't need access to the admin class) ────────

    public class ConnectionException extends Exception {}

    /** Apex REST cannot throw AuraHandledException (it surfaces as an
     *  uncatchable LimitException); an Aura caller wants exactly that. */
    private static Exception failure(String message) {
        return RestContext.request != null ? (Exception) new ConnectionException(message) : (Exception) new AuraHandledException(message);
    }

    private static HttpResponse callout(String method, String path, String body) {
        ArchonInstall__c install = ArchonInstall__c.getOrgDefaults();
        if (install == null || String.isBlank(install.SessionKey__c)) {
            throw failure('Archon is not set up yet — ask your admin to run Archon Setup.');
        }
        String base = getServerUrl();
        if (String.isBlank(base)) {
            throw failure('Archon server URL is not configured — ask your admin.');
        }
        HttpRequest req = new HttpRequest();
        req.setEndpoint(base.removeEnd('/') + path);
        req.setMethod(method);
        req.setHeader('Authorization', 'Bearer ' + install.SessionKey__c);
        req.setHeader('Content-Type', 'application/json');
        if (String.isNotBlank(body)) req.setBody(body);
        req.setTimeout(CALLOUT_TIMEOUT_MS);
        return new Http().send(req);
    }

    private static String getServerUrl() {
        List<ArchonConfig__mdt> rows = [
            SELECT ServerUrl__c FROM ArchonConfig__mdt WHERE DeveloperName = 'Default' LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0].ServerUrl__c;
    }
}
