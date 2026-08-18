/**
 * Apex REST wrapper around AgentBuilderController's execution-log surface
 * (getExecutionLogs / getRunSteps) for the React "Runs / Execution Logs"
 * page — same data the old agentExecutionLogs LWC already used. Thin
 * marshalling only.
 */
@RestResource(urlMapping='/agent-builder/executions/*')
global with sharing class AgentExecutionsRestService {

    @HttpGet
    global static void handleGet() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            String correlationId = req.params.get('correlationId');
            if (String.isNotBlank(correlationId)) {
                AgentBuilderController.RunStepsResult steps = AgentBuilderController.getRunSteps(correlationId);
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(steps));
                return;
            }

            String agentId = req.params.get('agentId');
            String status = req.params.get('status');
            Integer pageSize = parseIntOrNull(req.params.get('pageSize'));
            Integer pageOffset = parseIntOrNull(req.params.get('pageOffset'));

            AgentBuilderController.ExecutionPage page =
                AgentBuilderController.getExecutionLogs(agentId, pageSize, pageOffset, status);
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(page));
        } catch (Exception e) {
            res.statusCode = 400;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => e.getMessage() }));
        }
    }

    private static Integer parseIntOrNull(String s) {
        if (String.isBlank(s)) return null;
        try { return Integer.valueOf(s); } catch (Exception e) { return null; }
    }
}
