// Mint a websocket ticket for one chat session, exactly as
// AgentWebSocketController.mintTicket does (server-to-server; the session
// key never leaves Apex). Single use, ~45 s: connect right away with
// scripts/ws-turn.mjs. Set the two values below first.
String agentApiName = 'metadata_expert';
String sessionId = 'a08g500000D8Q7uAAF';

ArchonInstall__c install = ArchonInstall__c.getOrgDefaults();
ArchonConfig__mdt cfg = [SELECT ServerUrl__c FROM ArchonConfig__mdt WHERE DeveloperName = 'Default' LIMIT 1];
AgentDefinition__c a = [SELECT Id FROM AgentDefinition__c WHERE ApiName__c = :agentApiName LIMIT 1];
AgentNode__c ai = [SELECT NodeSubType__c, AiEngineConnection__c FROM AgentNode__c WHERE AgentDefinition__c = :a.Id AND NodeType__c = 'ai' ORDER BY SortOrder__c ASC LIMIT 1];
AiEngineConnection__c cred = AiEngineConnectionController.resolveForRuntime(ai.NodeSubType__c, ai.AiEngineConnection__c);
Map<String, Object> payload = new Map<String, Object>{ 'agentApiName' => agentApiName, 'sessionId' => sessionId, 'userId' => UserInfo.getUserId() };
if (cred != null) {
    payload.put('engineOverride', new Map<String, Object>{ 'engineType' => cred.EngineType__c, 'apiKey' => cred.ApiKey__c, 'endpoint' => cred.Endpoint__c, 'defaultModel' => cred.DefaultModel__c, 'connectionId' => cred.Id });
}
HttpRequest req = new HttpRequest();
req.setEndpoint(cfg.ServerUrl__c.removeEnd('/') + '/api/ws/ticket');
req.setMethod('POST');
req.setHeader('Authorization', 'Bearer ' + install.SessionKey__c);
req.setHeader('Content-Type', 'application/json');
req.setBody(JSON.serialize(payload));
req.setTimeout(15000);
HttpResponse res = new Http().send(req);
// The '|' of a debug line is HTML-escaped in the CLI output; '~~' is not.
System.debug('TICKET~~' + res.getStatusCode() + '~~' + res.getBody());
