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
            HttpResponse res = post(new Map<String, Object>{ 'apiName' => apiName });
            return res != null && res.getStatusCode() >= 200 && res.getStatusCode() < 300;
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'SystemAgentSync.ensure failed for ' + apiName + ': ' + e.getMessage());
            return false;
        }
    }

    /**
     * Bring the wording of an agent the org owns (the Metadata Expert) up
     * to the shipped spec: instructions and tool descriptions only; the
     * org's wiring, tools and models stay as they are. Returns the
     * server's answer, for a script to print.
     */
    public static String refreshInstructions(String apiName) {
        HttpResponse res = post(new Map<String, Object>{ 'apiName' => apiName, 'refreshInstructions' => true });
        if (res == null) return 'not configured: no session key or server URL';
        return res.getStatusCode() + ' ' + res.getBody();
    }

    private static HttpResponse post(Map<String, Object> body) {
        ArchonInstall__c install = ArchonInstall__c.getOrgDefaults();
        if (install == null || String.isBlank(install.SessionKey__c)) return null;
        List<ArchonConfig__mdt> cfg = [SELECT ServerUrl__c FROM ArchonConfig__mdt WHERE DeveloperName = 'Default' LIMIT 1];
        if (cfg.isEmpty() || String.isBlank(cfg[0].ServerUrl__c)) return null;

        HttpRequest req = new HttpRequest();
        req.setEndpoint(cfg[0].ServerUrl__c.removeEnd('/') + '/api/system-agents/sync');
        req.setMethod('POST');
        req.setHeader('Authorization', 'Bearer ' + install.SessionKey__c);
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(body));
        req.setTimeout(CALLOUT_TIMEOUT_MS);
        return new Http().send(req);
    }
}
