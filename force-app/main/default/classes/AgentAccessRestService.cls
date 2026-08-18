/**
 * Apex REST wrapper for the React "Salesforce Access" page — a read-only
 * status dashboard combining the org-level Archon connection status
 * (SynapseSetupController.getStatus, same data the Setup wizard shows)
 * and per-user "Connect my Salesforce" status for PerUser-access-mode
 * agents (AgentConnectorController.listSalesforceUserConnections).
 * Bundled into one GET since the page always needs both together.
 */
@RestResource(urlMapping='/agent-builder/salesforce-access')
global with sharing class AgentAccessRestService {

    @HttpGet
    global static void getAccessStatus() {
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            SynapseSetupController.SetupStatus orgStatus = SynapseSetupController.getStatus();
            List<AgentConnectorController.UserConnection> userConnections =
                AgentConnectorController.listSalesforceUserConnections();
            Map<String, Object> payload = new Map<String, Object>{
                'orgStatus' => orgStatus,
                'userConnections' => userConnections
            };
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(payload));
        } catch (Exception e) {
            res.statusCode = 400;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => e.getMessage() }));
        }
    }
}
