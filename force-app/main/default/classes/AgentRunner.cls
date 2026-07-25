/**
 * AgentRunner.cls — Invocable method for Flow + direct Apex
 * with sharing, USER_MODE, callout=true
 */
public with sharing class AgentRunner {

    @InvocableMethod(
        label='Run AI Agent'
        description='Execute an Agent Builder agent. Returns score, priority, reason, status.'
        callout=true
        category='Agent Builder'
    )
    public static List<AgentOutput> run(List<AgentInput> inputs) {
        Set<String> apiNames = new Set<String>();
        for (AgentInput inp : inputs) apiNames.add(inp.agentApiName);

        Map<String, AgentDefinition__c> agentMap = new Map<String, AgentDefinition__c>();
        for (AgentDefinition__c a : [
            SELECT Id, ApiName__c, Status__c
            FROM AgentDefinition__c
            WHERE ApiName__c IN :apiNames
            WITH USER_MODE
        ]) {
            agentMap.put(a.ApiName__c, a);
        }

        // One AI node per agent (bulkified) — used to resolve the running
        // user's engine credential, same pattern AgentChatController uses.
        Set<Id> agentIds = new Set<Id>();
        for (AgentDefinition__c a : agentMap.values()) agentIds.add(a.Id);
        Map<Id, AgentNode__c> aiNodeByAgentId = new Map<Id, AgentNode__c>();
        for (AgentNode__c n : [
            SELECT Id, AgentDefinition__c, NodeSubType__c, AiEngineConnection__c
            FROM AgentNode__c
            WHERE AgentDefinition__c IN :agentIds AND NodeType__c = 'ai'
            WITH USER_MODE
            ORDER BY SortOrder__c ASC
        ]) {
            if (!aiNodeByAgentId.containsKey(n.AgentDefinition__c)) {
                aiNodeByAgentId.put(n.AgentDefinition__c, n);
            }
        }

        List<AgentOutput> results    = new List<AgentOutput>();
        List<AgentExecution__c> logs = new List<AgentExecution__c>();

        for (AgentInput inp : inputs) {
            AgentDefinition__c def = agentMap.get(inp.agentApiName);
            AgentOutput out        = new AgentOutput();

            if (def == null || def.Status__c != 'Active') {
                out.success     = false;
                out.agentStatus = 'ERROR';
                out.agentReason = def == null
                    ? 'Agent not found: ' + inp.agentApiName
                    : 'Agent is not active';
                results.add(out);
                continue;
            }

            try {
                out = callExternalEngine(inp, def.Id, aiNodeByAgentId.get(def.Id));
            } catch (Exception e) {
                out.success     = false;
                out.agentStatus = 'ERROR';
                out.agentReason = e.getMessage();
            }

            logs.add(buildLog(def.Id, inp, out));
            results.add(out);
        }

        if (!logs.isEmpty()) insert logs;
        return results;
    }

    private static AgentOutput callExternalEngine(AgentInput inp, String defId, AgentNode__c aiNode) {
        Map<String, Object> payload = new Map<String, Object>{
            'agentApiName' => inp.agentApiName,
            'recordId'     => inp.recordId,
            'userId'       => UserInfo.getUserId(),
            'runMode'      => String.isBlank(inp.runMode) ? 'sync' : inp.runMode,
            'inputPayload' => String.isNotBlank(inp.inputPayload)
                                ? JSON.deserializeUntyped(inp.inputPayload)
                                : new Map<String, Object>()
        };

        // Resolve the running user's AI Engine Connection — may be null,
        // in which case the Node server falls back to its .env keys.
        if (aiNode != null && String.isNotBlank(aiNode.NodeSubType__c)) {
            AiEngineConnection__c cred = AiEngineConnectionController.resolveForRuntime(
                aiNode.NodeSubType__c, aiNode.AiEngineConnection__c
            );
            if (cred != null) {
                payload.put('engineOverride', new Map<String, Object>{
                    'engineType'   => cred.EngineType__c,
                    'apiKey'       => cred.ApiKey__c,
                    'endpoint'     => cred.Endpoint__c,
                    'defaultModel' => cred.DefaultModel__c,
                    'connectionId' => cred.Id
                });
            }
        }

        HttpResponse res = ArchonServerClient.callout('POST', '/api/agent/execute', JSON.serialize(payload));
        if (res.getStatusCode() >= 400) {
            AgentOutput errOut = new AgentOutput();
            errOut.success     = false;
            errOut.agentStatus = 'ERROR';
            errOut.agentReason = ArchonServerClient.extractServerError(res);
            return errOut;
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());

        AgentOutput out        = new AgentOutput();
        out.success            = (Boolean) body.get('success');
        out.correlationId      = (String)  body.get('correlationId');
        out.agentStatus        = (String)  body.get('agentStatus');
        out.agentPriority      = (String)  body.get('agentPriority');
        out.agentReason        = (String)  body.get('agentReason');
        out.agentOutputPayload = (String)  body.get('agentOutputPayload');
        if (body.get('agentScore') != null) {
            out.agentScore = Integer.valueOf(body.get('agentScore'));
        }
        return out;
    }

    private static AgentExecution__c buildLog(String defId, AgentInput inp, AgentOutput out) {
        return new AgentExecution__c(
            AgentDefinition__c = defId,
            CorrelationId__c   = out.correlationId,
            RecordId__c        = inp.recordId,
            Status__c          = out.agentStatus,
            AgentScore__c      = out.agentScore,
            AgentPriority__c   = out.agentPriority,
            AgentReason__c     = out.agentReason,
            RunMode__c         = inp.runMode,
            OutputPayload__c   = out.agentOutputPayload
        );
    }

    public class AgentInput {
        @InvocableVariable(required=true  label='Agent API Name')        public String agentApiName;
        @InvocableVariable(required=true  label='Record ID')             public String recordId;
        @InvocableVariable(required=false label='Run Mode (sync/async)') public String runMode;
        @InvocableVariable(required=false label='Input Payload JSON')    public String inputPayload;
    }

    public class AgentOutput {
        @InvocableVariable(label='Success')              public Boolean success;
        @InvocableVariable(label='Correlation ID')       public String  correlationId;
        @InvocableVariable(label='Agent Score 0-100')    public Integer agentScore;
        @InvocableVariable(label='Priority')             public String  agentPriority;
        @InvocableVariable(label='Reason / Explanation') public String  agentReason;
        @InvocableVariable(label='Status')               public String  agentStatus;
        @InvocableVariable(label='Output JSON')          public String  agentOutputPayload;
    }
}
