/**
 * Reads a large tool result the Archon server stored by reference, for the
 * chat UI to draw in full. The server returns JSON; this passes it through
 * untouched. Plain exceptions only — this is reached from a REST path.
 */
public with sharing class ArchonArtifactReader {
    private static final Integer CALLOUT_TIMEOUT_MS = 30000;

    public static String read(String artifactId) {
        if (String.isBlank(artifactId) || !Pattern.matches('^art_[0-9a-f]{10}$', artifactId)) {
            throw new IllegalArgumentException('Invalid artifact id.');
        }
        SynapseInstall__c install = SynapseInstall__c.getOrgDefaults();
        if (install == null || String.isBlank(install.SessionKey__c)) {
            throw new IllegalArgumentException('Archon is not set up yet — ask your admin to run Archon Setup.');
        }
        List<SynapseConfig__mdt> cfg = [SELECT ServerUrl__c FROM SynapseConfig__mdt WHERE DeveloperName = 'Default' LIMIT 1];
        if (cfg.isEmpty() || String.isBlank(cfg[0].ServerUrl__c)) {
            throw new IllegalArgumentException('Archon server URL is not configured — ask your admin.');
        }
        HttpRequest req = new HttpRequest();
        req.setEndpoint(cfg[0].ServerUrl__c.removeEnd('/') + '/api/artifacts/' + artifactId);
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + install.SessionKey__c);
        req.setTimeout(CALLOUT_TIMEOUT_MS);
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() >= 400) {
            throw new IllegalArgumentException('Archon answered ' + res.getStatusCode() + ' for this result: ' + res.getBody().left(200));
        }
        return res.getBody();
    }
}
