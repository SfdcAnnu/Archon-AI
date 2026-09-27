/**
 * ArchonServerClient — shared callout helper for talking to the Archon
 * Node server, using the SAME auth pattern as chat:
 *   Authorization: Bearer <SynapseInstall__c.SessionKey__c>
 *   endpoint:      SynapseConfig__mdt.Default.ServerUrl__c + path
 *
 * Extracted from AgentChatController so AgentRunner, AgentBuilderController,
 * and any future caller share one implementation instead of copy-pasting it.
 * Replaces the old per-agent JWT (JwtSigner + "Agent_Platform" Named
 * Credential) — the server now derives orgId from this session key via
 * sessionAuth, the same trust boundary chat already relies on.
 */
public with sharing class ArchonServerClient {

    private static final Integer DEFAULT_TIMEOUT_MS = 120000;

    public class NotConfiguredException extends Exception {}

    public static HttpResponse callout(String method, String path, String body) {
        return callout(method, path, body, DEFAULT_TIMEOUT_MS);
    }

    public static HttpResponse callout(String method, String path, String body, Integer timeoutMs) {
        SynapseInstall__c install = SynapseInstall__c.getOrgDefaults();
        if (install == null || String.isBlank(install.SessionKey__c)) {
            throw new NotConfiguredException('Archon is not set up yet. Open Archon Setup and click Authorize first.');
        }
        String base = getServerUrl();
        if (String.isBlank(base)) {
            throw new NotConfiguredException('Archon Config ServerUrl__c is not set. Setup → Custom Metadata Types → Synapse Config → Manage Records → Default → edit ServerUrl__c.');
        }

        HttpRequest req = new HttpRequest();
        req.setEndpoint(base.removeEnd('/') + path);
        req.setMethod(method);
        req.setHeader('Authorization', 'Bearer ' + install.SessionKey__c);
        req.setHeader('Content-Type', 'application/json');
        if (String.isNotBlank(body)) req.setBody(body);
        req.setTimeout(timeoutMs);
        return new Http().send(req);
    }

    /** Unwrap the server's JSON `{message}` field for user-facing errors; falls back to the raw body. */
    public static String extractServerError(HttpResponse res) {
        String raw = res.getBody();
        if (String.isBlank(raw)) return 'Server error ' + res.getStatusCode();
        try {
            Map<String, Object> j = (Map<String, Object>) JSON.deserializeUntyped(raw);
            if (j.containsKey('message') && j.get('message') != null) {
                return (String) j.get('message');
            }
        } catch (Exception e) { /* not JSON */ }
        return raw.length() > 400 ? raw.left(400) + '…' : raw;
    }

    private static String getServerUrl() {
        List<SynapseConfig__mdt> rows = [
            SELECT ServerUrl__c FROM SynapseConfig__mdt WHERE DeveloperName = 'Default' LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0].ServerUrl__c;
    }
}
