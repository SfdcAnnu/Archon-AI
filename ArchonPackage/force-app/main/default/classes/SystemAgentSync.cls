/**
 * Built-in agents (the Archon Copilot) are defined on the Archon server and
 * written into this org's agent records on first use. When a chat starts
 * for an API name that has no record yet, this asks the server to create
 * it — the server answers 404 for a name it does not ship, so nothing is
 * invented for an ordinary typo.
 *
 * A callout, so it must run before any DML in the transaction. Failures
 * are swallowed into `false`: the caller then reports "no such agent"
 * exactly as it would have without this.
 */
public with sharing class SystemAgentSync {
    private static final Integer CALLOUT_TIMEOUT_MS = 60000;

    /** True when the server created (or confirmed) the built-in agent. */
    public static Boolean ensure(String apiName) {
        if (String.isBlank(apiName)) return false;
        try {
            SynapseInstall__c install = SynapseInstall__c.getOrgDefaults();
            if (install == null || String.isBlank(install.SessionKey__c)) return false;
            List<SynapseConfig__mdt> cfg = [SELECT ServerUrl__c FROM SynapseConfig__mdt WHERE DeveloperName = 'Default' LIMIT 1];
            if (cfg.isEmpty() || String.isBlank(cfg[0].ServerUrl__c)) return false;

            HttpRequest req = new HttpRequest();
            req.setEndpoint(cfg[0].ServerUrl__c.removeEnd('/') + '/api/system-agents/sync');
            req.setMethod('POST');
            req.setHeader('Authorization', 'Bearer ' + install.SessionKey__c);
            req.setHeader('Content-Type', 'application/json');
            req.setBody(JSON.serialize(new Map<String, String>{ 'apiName' => apiName }));
            req.setTimeout(CALLOUT_TIMEOUT_MS);
            HttpResponse res = new Http().send(req);
            return res.getStatusCode() >= 200 && res.getStatusCode() < 300;
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'SystemAgentSync.ensure failed for ' + apiName + ': ' + e.getMessage());
            return false;
        }
    }
}
