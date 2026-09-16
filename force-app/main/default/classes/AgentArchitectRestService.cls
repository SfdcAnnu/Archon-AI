/**
 * Thin REST wrapper for the Agent Architect — the master agent that turns a
 * plain-language requirement into a working agent built only from what the
 * org already has.
 *
 * A build runs for minutes, far beyond an Apex callout, so this proxies an
 * ASYNC job: POST starts it and returns a job id; GET polls until it lands.
 * All the work (and the only write, which touches Archon package records
 * only) happens server-side.
 */
@RestResource(urlMapping='/agent-builder/architect/*')
global with sharing class AgentArchitectRestService {

    @HttpPost
    global static void startBuild() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());

            // Two interactive surfaces share this POST: the instruction
            // rewriter (the sparkle on a prompt box) and the copilot. Both
            // are synchronous — unlike a build, they answer in one call.
            String action = (String) body.get('action');
            if (action == 'rewrite' || action == 'copilot') {
                body.remove('action');
                String path = action == 'rewrite' ? '/api/architect/rewrite-prompt' : '/api/architect/copilot';
                HttpResponse assistRes = ArchonServerClient.callout('POST', path, JSON.serialize(body), 120000);
                if (assistRes.getStatusCode() >= 400) {
                    writeError(res, 400, ArchonServerClient.extractServerError(assistRes));
                    return;
                }
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(assistRes.getBody());
                return;
            }

            Map<String, Object> payload = new Map<String, Object>();

            // Continuing a build that stopped at its budget ceiling. The
            // requirement is NOT re-sent: the server already holds it, along
            // with every stage the customer has already paid for, and taking
            // it from the client again would let the two drift apart.
            String resumeJobId = (String) body.get('resumeJobId');
            if (String.isNotBlank(resumeJobId)) {
                payload.put('resumeJobId', resumeJobId);
            } else {
                String requirement = (String) body.get('requirement');
                if (String.isBlank(requirement) || requirement.length() < 20) {
                    writeError(res, 400, 'Describe the agent in at least a sentence or two.');
                    return;
                }
                payload.put('requirement', requirement);
                if (body.get('attachmentText') != null) payload.put('attachmentText', body.get('attachmentText'));
            }
            if (body.get('maxCostUsd') != null) payload.put('maxCostUsd', body.get('maxCostUsd'));

            HttpResponse serverRes = ArchonServerClient.callout('POST', '/api/architect/build', JSON.serialize(payload), 60000);
            if (serverRes.getStatusCode() >= 400) {
                writeError(res, 400, 'Could not start the build: ' + ArchonServerClient.extractServerError(serverRes));
                return;
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(serverRes.getBody());
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    @HttpGet
    global static void getBuild() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            // Builds that stopped early but kept their work. Without this
            // the only way back to a checkpoint is a build page the user
            // never navigated away from — so the work they already paid for
            // would be stranded in the database.
            if (req.params.get('resumable') == 'true') {
                HttpResponse listRes = ArchonServerClient.callout(
                    'GET', '/api/architect/builds/resumable', null, 60000);
                if (listRes.getStatusCode() >= 400) {
                    writeError(res, 400, ArchonServerClient.extractServerError(listRes));
                    return;
                }
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(listRes.getBody());
                return;
            }

            String jobId = req.params.get('jobId');
            if (String.isBlank(jobId)) {
                writeError(res, 400, 'jobId is required.');
                return;
            }
            HttpResponse serverRes = ArchonServerClient.callout(
                'GET', '/api/architect/build/' + EncodingUtil.urlEncode(jobId, 'UTF-8'), null, 60000);
            if (serverRes.getStatusCode() >= 400) {
                writeError(res, 400, 'Could not read the build: ' + ArchonServerClient.extractServerError(serverRes));
                return;
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(serverRes.getBody());
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    /**
     * Forget a build and its saved progress.
     *
     * A build's checkpoint lives on the Archon server, not in Salesforce, so
     * deleting the agent it was going to create leaves the build behind —
     * still offering to rebuild something the client removed on purpose.
     */
    @HttpDelete
    global static void deleteBuild() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            String jobId = req.params.get('jobId');
            if (String.isBlank(jobId)) {
                writeError(res, 400, 'jobId is required.');
                return;
            }
            HttpResponse serverRes = ArchonServerClient.callout(
                'DELETE', '/api/architect/build/' + EncodingUtil.urlEncode(jobId, 'UTF-8'), null, 60000);
            if (serverRes.getStatusCode() >= 400) {
                writeError(res, 400, 'Could not discard the build: ' + ArchonServerClient.extractServerError(serverRes));
                return;
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(serverRes.getBody());
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    private static void writeError(RestResponse res, Integer statusCode, String message) {
        res.statusCode = statusCode;
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => message }));
    }
}
