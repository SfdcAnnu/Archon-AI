/**
 * Apex REST wrapper around AgentConnectorController.getDirectory() for the
 * React UI Bundle — same reasoning as AgentBuilderRestService.cls: a UI
 * Bundle can't reach @AuraEnabled methods, and this just marshals JSON
 * around the EXISTING, already-in-production directory logic rather than
 * reimplementing it.
 */
@RestResource(urlMapping='/agent-builder/connectors')
global with sharing class AgentConnectorRestService {

    @HttpGet
    global static void getDirectory() {
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            List<AgentConnectorController.DirectoryEntry> entries = AgentConnectorController.getDirectory();
            // The controller silently degrades to "everything NotConfigured"
            // when the Archon server itself was unreachable (idle Render
            // service waking) — which the UI would render as every connector
            // being disconnected, a lie. Surface it as a retryable signal
            // instead of returning the misleading fallback data.
            if (AgentConnectorController.directoryServerUnreachable) {
                res.statusCode = 503;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{
                    'error' => 'SERVER_WAKING: The Archon server is waking up from idle — this usually takes under a minute.'
                }));
                return;
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(entries));
        } catch (Exception e) {
            res.statusCode = 400;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => e.getMessage() }));
        }
    }
}
