/**
 * Archon AI — SELF-SERVICE personal Salesforce connection for chat users.
 *
 * Deliberately separate from AgentConnectorController (admin powers live
 * there; Apex class access is all-or-nothing, so chat users get ONLY this
 * class). Every method acts on the running user — a chat user can never
 * connect, inspect, or disconnect anyone else's account.
 *
 * Used by the chat panel's inline connect card when an agent's
 * AccessMode__c = 'PerUser'.
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

    /** Access mode of the agent + whether the RUNNING user has a personal
     *  Salesforce connection on the server. The chat panel calls this on
     *  session open and while polling after the OAuth popup. */
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

    /** Mints the OAuth authorize URL for the RUNNING user's personal
     *  Salesforce connection. The browser opens it; the server's callback
     *  stores the tokens keyed by this user. */
    @AuraEnabled
    public static StartResult startMyConnection(String returnUrl) {
        HttpResponse res = callout('POST', '/api/connectors/oauth/start',
            JSON.serialize(new Map<String, Object>{
                'providerKey' => 'salesforce_mcp',
                'displayName' => 'Salesforce (my account)',
                'returnUrl'   => returnUrl,
                'userId'      => UserInfo.getUserId()
            }));
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Could not start the connection: ' + res.getBody());
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        StartResult out = new StartResult();
        out.authorizeUrl = (String) body.get('authorizeUrl');
        return out;
    }

    // ── Callout plumbing (mirrors AgentConnectorController, kept private
    //    here so chat users don't need access to the admin class) ────────

    private static HttpResponse callout(String method, String path, String body) {
        SynapseInstall__c install = SynapseInstall__c.getOrgDefaults();
        if (install == null || String.isBlank(install.SessionKey__c)) {
            throw new AuraHandledException('Archon is not set up yet — ask your admin to run Archon Setup.');
        }
        String base = getServerUrl();
        if (String.isBlank(base)) {
            throw new AuraHandledException('Archon server URL is not configured — ask your admin.');
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
        List<SynapseConfig__mdt> rows = [
            SELECT ServerUrl__c FROM SynapseConfig__mdt WHERE DeveloperName = 'Default' LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0].ServerUrl__c;
    }
}
