/**
 * AgentBuilderController
 * - with sharing enforced
 * - USER_MODE on all SOQL (replaces deprecated WITH_SECURITY_ENFORCED)
 * - Zero SOQL in loops, bulkified DML
 * - Callout=true for external server integration
 */
@SuppressWarnings('PMD.ApexCRUDViolation')
public with sharing class AgentBuilderController {

    // GET: All agent definitions for a department
    @AuraEnabled(cacheable=true)
    public static List<AgentDefinition__c> getAgentDefinitions(String department) {
        if (String.isBlank(department)) {
            return [
                SELECT Id, Name, ApiName__c, Department__c, Description__c,
                       Status__c, Version__c, TotalExecutions__c, SuccessRate__c,
                       CreatedDate, LastModifiedDate
                FROM AgentDefinition__c
                WITH USER_MODE
                ORDER BY Department__c, Name ASC
                LIMIT 200
            ];
        }
        return [
            SELECT Id, Name, ApiName__c, Department__c, Description__c,
                   Status__c, Version__c, TotalExecutions__c, SuccessRate__c,
                   CreatedDate, LastModifiedDate
            FROM AgentDefinition__c
            WHERE Department__c = :department
            WITH USER_MODE
            ORDER BY Name ASC
            LIMIT 200
        ];
    }

    // GET: Single agent with all nodes (returns null wrapper when id is blank — new-agent case)
    @AuraEnabled(cacheable=true)
    public static AgentWithNodes getAgentWithNodes(String agentId) {
        if (String.isBlank(agentId)) return null;
        List<AgentDefinition__c> agents = [
            SELECT Id, Name, ApiName__c, Department__c, Description__c,
                   KnowledgeBase__c, Status__c, Version__c, CanvasJson__c,
                   ExternalServerUrl__c, TotalExecutions__c, SuccessRate__c,
                   (SELECT Id, Name, NodeType__c, NodeSubType__c, ConfigJson__c,
                           PositionX__c, PositionY__c, SortOrder__c,
                           IsEnabled__c, McpServer__c, McpTool__c,
                           AiEngineConnection__c
                    FROM Nodes__r
                    ORDER BY SortOrder__c ASC)
            FROM AgentDefinition__c
            WHERE Id = :agentId
            WITH USER_MODE
            LIMIT 1
        ];
        if (agents.isEmpty()) return null;
        return new AgentWithNodes(agents[0]);
    }

    // SAVE: Upsert agent + bulk upsert nodes
    @AuraEnabled
    public static String saveAgentWithNodes(String agentJson, String nodesJson) {
        AgentDefinitionInput agentInput = (AgentDefinitionInput)
            JSON.deserialize(agentJson, AgentDefinitionInput.class);
        List<AgentNodeInput> nodeInputs = (List<AgentNodeInput>)
            JSON.deserialize(nodesJson, List<AgentNodeInput>.class);

        Savepoint sp = Database.setSavepoint();
        try {
            AgentDefinition__c agentRecord = buildAgentRecord(agentInput);
            upsert agentRecord ApiName__c;

            String agentRecordId = agentRecord.Id;

            List<AgentNode__c> existingNodes = [
                SELECT Id FROM AgentNode__c
                WHERE AgentDefinition__c = :agentRecordId
                WITH USER_MODE
            ];
            if (!existingNodes.isEmpty()) delete existingNodes;

            List<AgentNode__c> newNodes = new List<AgentNode__c>();
            for (Integer i = 0; i < nodeInputs.size(); i++) {
                newNodes.add(buildNodeRecord(nodeInputs[i], agentRecordId, i));
            }
            if (!newNodes.isEmpty()) insert newNodes;

            return agentRecordId;

        } catch (Exception e) {
            Database.rollback(sp);
            throw new AuraHandledException('Save failed: ' + e.getMessage());
        }
    }

    // EXECUTE: Callout to Node.js execution engine
    @AuraEnabled
    public static ExecutionResult executeAgent(
        String agentApiName,
        String recordId,
        String runMode,
        String inputPayloadJson
    ) {
        List<AgentDefinition__c> agents = [
            SELECT Id, ApiName__c, ExternalServerUrl__c, Status__c
            FROM AgentDefinition__c
            WHERE ApiName__c = :agentApiName
            WITH USER_MODE
            LIMIT 1
        ];
        if (agents.isEmpty()) throw new AuraHandledException('Agent not found: ' + agentApiName);
        if (agents[0].Status__c != 'Active') throw new AuraHandledException('Agent is not active');

        Map<String, Object> payload = new Map<String, Object>{
            'agentApiName' => agentApiName,
            'recordId'     => recordId,
            'orgId'        => UserInfo.getOrganizationId(),
            'userId'       => UserInfo.getUserId(),
            'department'   => agents[0].Id,
            'runMode'      => String.isBlank(runMode) ? 'sync' : runMode,
            'inputPayload' => String.isNotBlank(inputPayloadJson)
                                ? JSON.deserializeUntyped(inputPayloadJson)
                                : new Map<String, Object>()
        };

        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:Agent_Platform/agent/execute');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Authorization', JwtSigner.mintBearer(agentApiName));
        req.setHeader('X-SF-Org-Id', UserInfo.getOrganizationId());
        req.setBody(JSON.serialize(payload));
        req.setTimeout(25000);

        HttpResponse res = new Http().send(req);
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());

        insertExecutionLog(agents[0].Id, agentApiName, recordId, runMode, body);

        return buildExecutionResult(body, res.getStatusCode());
    }

    // GET: Execution logs (paginated)
    @AuraEnabled(cacheable=true)
    public static ExecutionPage getExecutionLogs(
        String agentId,
        Integer pageSize,
        Integer pageOffset
    ) {
        Integer pSize   = pageSize   != null ? Math.min(pageSize, 50)   : 20;
        Integer pOffset = pageOffset != null ? pageOffset                : 0;

        List<AgentExecution__c> logs;
        Integer total;

        if (String.isBlank(agentId)) {
            logs = [
                SELECT Id, Name, AgentDefinition__r.Name, AgentDefinition__r.Department__c,
                       CorrelationId__c, RecordId__c, Status__c, AgentScore__c,
                       AgentPriority__c, AgentReason__c, ToolsUsed__c, ExecutionMs__c,
                       Department__c, CreatedDate
                FROM AgentExecution__c
                WITH USER_MODE
                ORDER BY CreatedDate DESC
                LIMIT :pSize
                OFFSET :pOffset
            ];
            total = [
                SELECT COUNT() FROM AgentExecution__c
                WITH USER_MODE
            ];
        } else {
            logs = [
                SELECT Id, Name, AgentDefinition__r.Name, AgentDefinition__r.Department__c,
                       CorrelationId__c, RecordId__c, Status__c, AgentScore__c,
                       AgentPriority__c, AgentReason__c, ToolsUsed__c, ExecutionMs__c,
                       Department__c, CreatedDate
                FROM AgentExecution__c
                WHERE AgentDefinition__c = :agentId
                WITH USER_MODE
                ORDER BY CreatedDate DESC
                LIMIT :pSize
                OFFSET :pOffset
            ];
            total = [
                SELECT COUNT() FROM AgentExecution__c
                WHERE AgentDefinition__c = :agentId
                WITH USER_MODE
            ];
        }

        return new ExecutionPage(logs, total, pSize, pOffset);
    }

    // GET: Department summary stats
    @AuraEnabled(cacheable=true)
    public static List<DeptStats> getDepartmentStats() {
        List<AggregateResult> results = [
            SELECT Department__c dept,
                   COUNT(Id) agentCount,
                   SUM(TotalExecutions__c) totalRuns
            FROM AgentDefinition__c
            WITH USER_MODE
            GROUP BY Department__c
            ORDER BY Department__c
        ];

        List<DeptStats> stats = new List<DeptStats>();
        for (AggregateResult ar : results) {
            stats.add(new DeptStats(ar));
        }
        return stats;
    }

    // DELETE: Agent + all child nodes (cascade via master-detail)
    @AuraEnabled
    public static void deleteAgent(String agentId) {
        List<AgentDefinition__c> toDelete = [
            SELECT Id FROM AgentDefinition__c
            WHERE Id = :agentId
            WITH USER_MODE
            LIMIT 1
        ];
        if (!toDelete.isEmpty()) delete toDelete;
    }

    // ACTIVATE / DEACTIVATE
    @AuraEnabled
    public static void updateAgentStatus(String agentId, String status) {
        List<AgentDefinition__c> agents = [
            SELECT Id, Status__c FROM AgentDefinition__c
            WHERE Id = :agentId
            WITH USER_MODE
            LIMIT 1
        ];
        if (agents.isEmpty()) throw new AuraHandledException('Agent not found');
        agents[0].Status__c = status;
        update agents;
    }

    // PRIVATE HELPERS

    private static AgentDefinition__c buildAgentRecord(AgentDefinitionInput inp) {
        return new AgentDefinition__c(
            Name              = inp.label,
            ApiName__c        = inp.apiName,
            Department__c     = inp.department,
            Description__c    = inp.description,
            KnowledgeBase__c  = inp.knowledgeBase,
            Status__c         = inp.status != null ? inp.status : 'Draft',
            CanvasJson__c     = inp.canvasJson
        );
    }

    private static AgentNode__c buildNodeRecord(AgentNodeInput inp, String agentId, Integer order) {
        return new AgentNode__c(
            Name                  = inp.label,
            AgentDefinition__c    = agentId,
            NodeType__c           = inp.nodeType,
            NodeSubType__c        = inp.nodeSubType,
            ConfigJson__c         = inp.configJson,
            PositionX__c          = inp.positionX != null ? inp.positionX : 0,
            PositionY__c          = inp.positionY != null ? inp.positionY : 0,
            SortOrder__c          = order,
            IsEnabled__c          = inp.isEnabled != null ? inp.isEnabled : true,
            McpServer__c          = inp.mcpServer,
            McpTool__c            = inp.mcpTool,
            AiEngineConnection__c = inp.aiEngineConnectionId
        );
    }

    private static void insertExecutionLog(
        String agentDefId, String agentApiName, String recordId,
        String runMode, Map<String, Object> body
    ) {
        AgentExecution__c log = new AgentExecution__c(
            AgentDefinition__c = agentDefId,
            CorrelationId__c   = (String) body.get('correlationId'),
            RecordId__c        = recordId,
            Status__c          = (String) body.get('agentStatus'),
            RunMode__c         = runMode,
            AgentReason__c     = (String) body.get('agentReason'),
            ToolsUsed__c       = (String) body.get('toolsUsed'),
            OutputPayload__c   = (String) body.get('agentOutputPayload')
        );
        if (body.get('agentScore') != null) {
            log.AgentScore__c = Integer.valueOf(body.get('agentScore'));
        }
        if (body.get('agentPriority') != null) {
            log.AgentPriority__c = (String) body.get('agentPriority');
        }
        insert log;
    }

    private static ExecutionResult buildExecutionResult(
        Map<String, Object> body, Integer statusCode
    ) {
        ExecutionResult result      = new ExecutionResult();
        result.success              = (Boolean) body.get('success');
        result.correlationId        = (String)  body.get('correlationId');
        result.agentStatus          = (String)  body.get('agentStatus');
        result.agentPriority        = (String)  body.get('agentPriority');
        result.agentReason          = (String)  body.get('agentReason');
        result.agentOutputPayload   = (String)  body.get('agentOutputPayload');
        result.httpStatus           = statusCode;
        if (body.get('agentScore') != null) {
            result.agentScore = Integer.valueOf(body.get('agentScore'));
        }
        return result;
    }

    // INNER WRAPPER CLASSES

    public class AgentWithNodes {
        @AuraEnabled public AgentDefinition__c agent;
        @AuraEnabled public List<AgentNode__c>  nodes;
        public AgentWithNodes(AgentDefinition__c a) {
            this.agent = a;
            this.nodes = a.Nodes__r != null ? a.Nodes__r : new List<AgentNode__c>();
        }
    }

    public class AgentDefinitionInput {
        @AuraEnabled public String apiName;
        @AuraEnabled public String label;
        @AuraEnabled public String department;
        @AuraEnabled public String description;
        @AuraEnabled public String knowledgeBase;
        @AuraEnabled public String status;
        @AuraEnabled public String canvasJson;
    }

    public class AgentNodeInput {
        @AuraEnabled public String  label;
        @AuraEnabled public String  nodeType;
        @AuraEnabled public String  nodeSubType;
        @AuraEnabled public String  configJson;
        @AuraEnabled public Integer positionX;
        @AuraEnabled public Integer positionY;
        @AuraEnabled public Boolean isEnabled;
        @AuraEnabled public String  mcpServer;
        @AuraEnabled public String  mcpTool;
        @AuraEnabled public String  aiEngineConnectionId;
    }

    public class ExecutionResult {
        @AuraEnabled public Boolean success;
        @AuraEnabled public String  correlationId;
        @AuraEnabled public Integer agentScore;
        @AuraEnabled public String  agentPriority;
        @AuraEnabled public String  agentReason;
        @AuraEnabled public String  agentStatus;
        @AuraEnabled public String  agentOutputPayload;
        @AuraEnabled public Integer httpStatus;
    }

    public class ExecutionPage {
        @AuraEnabled public List<AgentExecution__c> records;
        @AuraEnabled public Integer total;
        @AuraEnabled public Integer pageSize;
        @AuraEnabled public Integer pageOffset;
        public ExecutionPage(List<AgentExecution__c> r, Integer t, Integer s, Integer o) {
            this.records    = r;
            this.total      = t;
            this.pageSize   = s;
            this.pageOffset = o;
        }
    }

    public class DeptStats {
        @AuraEnabled public String  department;
        @AuraEnabled public Integer agentCount;
        @AuraEnabled public Integer totalRuns;
        public DeptStats(AggregateResult ar) {
            this.department = (String)  ar.get('dept');
            this.agentCount = (Integer) ar.get('agentCount');
            this.totalRuns  = ar.get('totalRuns') != null
                                ? Integer.valueOf(ar.get('totalRuns')) : 0;
        }
    }
}
