/**
 * AgentGeneratorController — proxy for AI agent generation
 * (/api/agent/generate on the Archon Node server). Pure callout layer,
 * same pattern as AgentKbController/AgentConnectorController.
 */
public with sharing class AgentGeneratorController {

    @AuraEnabled
    public static GenerateResult generateAgent(String requirementText, String fileBase64, String qaHistoryJson) {
        Map<String, Object> payload = new Map<String, Object>{ 'requirementText' => requirementText };
        if (String.isNotBlank(fileBase64)) payload.put('fileBase64', fileBase64);
        if (String.isNotBlank(qaHistoryJson)) {
            payload.put('qaHistory', JSON.deserializeUntyped(qaHistoryJson));
        }
        Map<String, Object> engineOverride = buildEngineOverride();
        if (engineOverride != null) payload.put('engineOverride', engineOverride);

        HttpResponse res = ArchonServerClient.callout('POST', '/api/agent/generate', JSON.serialize(payload), 120000);
        throwIfServerWaking(res);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Generation failed: ' + ArchonServerClient.extractServerError(res));
        }
        return parseResult(res.getBody());
    }

    private static Map<String, Object> buildEngineOverride() {
        AiEngineConnection__c cred = AiEngineConnectionController.resolveForRuntime('claude', null);
        if (cred == null) return null;
        return new Map<String, Object>{
            'engineType'   => cred.EngineType__c,
            'apiKey'       => cred.ApiKey__c,
            'endpoint'     => cred.Endpoint__c,
            'defaultModel' => cred.DefaultModel__c,
            'connectionId' => cred.Id
        };
    }

    /**
     * Free-tier Render sleeps idle services; while one wakes (~30-60s) its
     * edge answers requests with an HTML "Application loading" page. Turn
     * that into a machine-readable signal the LWC auto-retries on, instead
     * of dumping raw HTML at the user (same pattern as
     * AgentConnectorController/AgentKbController).
     */
    private static void throwIfServerWaking(HttpResponse res) {
        String body = res.getBody();
        Boolean htmlBody = body != null && body.trim().startsWith('<');
        if (htmlBody || res.getStatusCode() == 502 || res.getStatusCode() == 503) {
            throw new AuraHandledException('SERVER_WAKING: The Archon server is waking up from idle — this usually takes under a minute.');
        }
    }

    private static GenerateResult parseResult(String rawBody) {
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(rawBody);
        GenerateResult result = new GenerateResult();
        result.kind = (String) body.get('kind');

        if (result.kind == 'questions') {
            result.questions = new List<String>();
            for (Object q : (List<Object>) body.get('questions')) result.questions.add((String) q);
            return result;
        }

        Map<String, Object> agentMap = (Map<String, Object>) body.get('agent');
        if (agentMap != null) {
            result.agentName     = (String) agentMap.get('name');
            result.department    = (String) agentMap.get('department');
            result.description   = (String) agentMap.get('description');
            result.knowledgeBase = (String) agentMap.get('knowledgeBase');
        }

        result.nodes = new List<GeneratedNodeDto>();
        for (Object n : (List<Object>) body.get('nodes')) {
            Map<String, Object> nm = (Map<String, Object>) n;
            GeneratedNodeDto dto = new GeneratedNodeDto();
            dto.label       = (String) nm.get('label');
            dto.nodeType    = (String) nm.get('type');
            dto.nodeSubType = (String) nm.get('subType');
            dto.configJson  = JSON.serialize(nm.get('config'));
            dto.rationale   = (String) nm.get('rationale');
            dto.x           = toDecimal(nm.get('x'));
            dto.y           = toDecimal(nm.get('y'));
            result.nodes.add(dto);
        }

        result.connections = new List<GeneratedConnectionDto>();
        for (Object c : (List<Object>) body.get('connections')) {
            Map<String, Object> cm = (Map<String, Object>) c;
            GeneratedConnectionDto dto = new GeneratedConnectionDto();
            dto.fromIndex = toInteger(cm.get('fromIndex'));
            dto.fromPort  = (String) cm.get('fromPort');
            dto.toIndex   = toInteger(cm.get('toIndex'));
            dto.toPort    = (String) cm.get('toPort');
            result.connections.add(dto);
        }

        result.setupChecklist = new List<ChecklistItemDto>();
        for (Object item : (List<Object>) body.get('setupChecklist')) {
            Map<String, Object> im = (Map<String, Object>) item;
            ChecklistItemDto dto = new ChecklistItemDto();
            dto.title       = (String) im.get('title');
            dto.description = (String) im.get('description');
            dto.category    = (String) im.get('category');
            result.setupChecklist.add(dto);
        }

        return result;
    }

    private static Decimal toDecimal(Object o) { return o != null ? Decimal.valueOf(String.valueOf(o)) : 0; }
    private static Integer toInteger(Object o) { return o != null ? Integer.valueOf(String.valueOf(o)) : 0; }

    // ── Wrappers ─────────────────────────────────────────────────────

    public class GenerateResult {
        @AuraEnabled public String kind; // 'questions' | 'agent'
        @AuraEnabled public List<String> questions;
        @AuraEnabled public String agentName;
        @AuraEnabled public String department;
        @AuraEnabled public String description;
        @AuraEnabled public String knowledgeBase;
        @AuraEnabled public List<GeneratedNodeDto> nodes;
        @AuraEnabled public List<GeneratedConnectionDto> connections;
        @AuraEnabled public List<ChecklistItemDto> setupChecklist;
    }

    public class GeneratedNodeDto {
        @AuraEnabled public String label;
        @AuraEnabled public String nodeType;
        @AuraEnabled public String nodeSubType;
        @AuraEnabled public String configJson;
        @AuraEnabled public String rationale;
        @AuraEnabled public Decimal x;
        @AuraEnabled public Decimal y;
    }

    public class GeneratedConnectionDto {
        @AuraEnabled public Integer fromIndex;
        @AuraEnabled public String fromPort;
        @AuraEnabled public Integer toIndex;
        @AuraEnabled public String toPort;
    }

    public class ChecklistItemDto {
        @AuraEnabled public String title;
        @AuraEnabled public String description;
        @AuraEnabled public String category;
    }
}
