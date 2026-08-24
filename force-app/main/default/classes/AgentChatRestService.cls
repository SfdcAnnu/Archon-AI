/**
 * Apex REST wrapper around the chat-session-lifecycle surface of
 * AgentChatController, plus AgentChatAttachmentController and
 * AgentUserConnectionController — everything the old synapseChatPanel LWC
 * needed for a full production chat experience (attachments, the PerUser
 * connect gate) that the React app's WebSocket test panel never had.
 * Thin marshalling only — zero duplicated logic, same as every other REST
 * wrapper in this app.
 *
 * Deliberately built on the HTTP+Apex path (not the newer WebSocket
 * gateway) — AgentChatController already has full parity for all of this
 * (proven, in production); extending the WS gateway to support
 * attachments/PerUser-gate from scratch would be a materially larger,
 * riskier undertaking than reusing what already works.
 */
@RestResource(urlMapping='/agent-builder/chat/*')
global with sharing class AgentChatRestService {

    @HttpGet
    global static void handleGet() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            if (req.params.get('resource') == 'gate') {
                AgentUserConnectionController.ConnectionGate gate =
                    AgentUserConnectionController.getGate(req.params.get('agentApiName'));
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(gate));
                return;
            }
            List<AgentChatController.AgentSummary> agents =
                AgentChatController.listChatEnabledAgents(req.params.get('filter'));
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(agents));
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    @HttpPost
    global static void handlePost() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());
            String action = (String) body.get('action');
            if (String.isBlank(action)) {
                writeError(res, 400, 'Body must include "action".');
                return;
            }

            if (action == 'startSession') {
                AgentChatController.SessionWithMessages result = AgentChatController.startSession(
                    (String) body.get('agentApiName'),
                    (String) body.get('recordContextId'),
                    (String) body.get('recordContextType')
                );
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(result));
                return;
            }
            if (action == 'sendTurn') {
                List<AgentChatController.AttachmentInput> attachments = parseAttachments(body.get('attachments'));
                AgentChatController.TurnResult result = AgentChatController.sendTurn(
                    (String) body.get('sessionId'), (String) body.get('userText'), attachments
                );
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(result));
                return;
            }
            if (action == 'endSession') {
                AgentChatController.endSession((String) body.get('sessionId'));
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Boolean>{ 'success' => true }));
                return;
            }
            if (action == 'uploadChatFile') {
                AgentChatAttachmentController.UploadResult upload = AgentChatAttachmentController.uploadChatFile(
                    (String) body.get('sessionId'),
                    (String) body.get('fileName'),
                    (String) body.get('mimeType'),
                    (String) body.get('base64')
                );
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(upload));
                return;
            }
            if (action == 'feedback') {
                String savedId = AgentChatController.saveMessageFeedback(
                    (String) body.get('sessionId'),
                    (String) body.get('messageId'),
                    (String) body.get('contentMatch'),
                    (String) body.get('value')
                );
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'messageId' => savedId }));
                return;
            }
            if (action == 'startMyConnection') {
                AgentUserConnectionController.StartResult startResult =
                    AgentUserConnectionController.startMyConnection((String) body.get('returnUrl'));
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(startResult));
                return;
            }
            writeError(res, 400, 'Unknown action "' + action + '".');
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    private static List<AgentChatController.AttachmentInput> parseAttachments(Object raw) {
        List<AgentChatController.AttachmentInput> out = new List<AgentChatController.AttachmentInput>();
        if (raw == null) return out;
        for (Object item : (List<Object>) raw) {
            Map<String, Object> m = (Map<String, Object>) item;
            AgentChatController.AttachmentInput a = new AgentChatController.AttachmentInput();
            a.contentDocumentId = (String) m.get('contentDocumentId');
            a.contentVersionId  = (String) m.get('contentVersionId');
            a.fileName          = (String) m.get('fileName');
            a.mimeType           = (String) m.get('mimeType');
            a.fileExtension      = (String) m.get('fileExtension');
            out.add(a);
        }
        return out;
    }

    private static void writeError(RestResponse res, Integer statusCode, String message) {
        res.statusCode = statusCode;
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => message }));
    }
}
