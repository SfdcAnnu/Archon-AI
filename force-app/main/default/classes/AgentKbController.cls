/**
 * AgentKbController — proxy for the RAG knowledge base API on the Archon
 * Node server (/api/kb/*). Pure callout layer, same pattern as
 * AgentConnectorController: no secrets or document content ever touch
 * Apex directly — SESSION_KEY-authenticated callouts do the work.
 */
public with sharing class AgentKbController {

    // ── Storage backend config ─────────────────────────────────────────

    @AuraEnabled
    public static StorageConfig getStorageConfig() {
        HttpResponse res = ArchonServerClient.callout('GET', '/api/kb/storage-config', null);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Could not load storage config: ' + ArchonServerClient.extractServerError(res));
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        StorageConfig cfg = new StorageConfig();
        cfg.backend = (String) body.get('backend');
        cfg.connectionUrlMasked = (String) body.get('connectionUrlMasked');
        cfg.hasConnectionUrl = body.get('hasConnectionUrl') == true;
        return cfg;
    }

    @AuraEnabled
    public static StorageConfig saveStorageConfig(String backend, String connectionUrl) {
        Map<String, Object> payload = new Map<String, Object>{ 'backend' => backend };
        if (String.isNotBlank(connectionUrl)) payload.put('connectionUrl', connectionUrl);
        HttpResponse res = ArchonServerClient.callout('POST', '/api/kb/storage-config', JSON.serialize(payload));
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException(ArchonServerClient.extractServerError(res));
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        StorageConfig cfg = new StorageConfig();
        cfg.backend = (String) body.get('backend');
        cfg.connectionUrlMasked = (String) body.get('connectionUrlMasked');
        return cfg;
    }

    /** Validates a customer Postgres URL (connects + ensures pgvector) before they commit to it. */
    @AuraEnabled
    public static void testConnection(String connectionUrl) {
        HttpResponse res = ArchonServerClient.callout('POST', '/api/kb/test-connection',
            JSON.serialize(new Map<String, Object>{ 'connectionUrl' => connectionUrl }));
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException(ArchonServerClient.extractServerError(res));
        }
    }

    // ── Documents ────────────────────────────────────────────────────

    @AuraEnabled
    public static List<KbDocumentDto> getDocuments(String agentApiName) {
        HttpResponse res = ArchonServerClient.callout('GET',
            '/api/kb/documents?agentApiName=' + EncodingUtil.urlEncode(agentApiName, 'UTF-8'), null);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Could not load documents: ' + ArchonServerClient.extractServerError(res));
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        List<KbDocumentDto> out = new List<KbDocumentDto>();
        for (Object item : (List<Object>) body.get('documents')) {
            out.add(parseDocument((Map<String, Object>) item));
        }
        return out;
    }

    /** Plain-text / pasted-content upload. File upload (base64) uses the same route with fileBase64/fileName instead of text. */
    @AuraEnabled
    public static KbDocumentDto uploadDocument(String agentApiName, String title, String text, String fileBase64, String fileName) {
        Map<String, Object> payload = new Map<String, Object>{
            'agentApiName' => agentApiName,
            'title'        => title
        };
        if (String.isNotBlank(fileBase64)) {
            payload.put('fileBase64', fileBase64);
            if (String.isNotBlank(fileName)) {
                payload.put('fileName', fileName);
            }
        } else {
            payload.put('text', text);
        }
        Map<String, Object> engineOverride = buildEmbeddingEngineOverride();
        if (engineOverride != null) payload.put('engineOverride', engineOverride);

        HttpResponse res = ArchonServerClient.callout('POST', '/api/kb/documents', JSON.serialize(payload), 120000);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Upload failed: ' + ArchonServerClient.extractServerError(res));
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        return parseDocument((Map<String, Object>) body.get('document'));
    }

    @AuraEnabled
    public static KbDocumentDto reindexDocument(String documentId) {
        Map<String, Object> engineOverride = buildEmbeddingEngineOverride();
        Map<String, Object> payload = new Map<String, Object>();
        if (engineOverride != null) payload.put('engineOverride', engineOverride);

        HttpResponse res = ArchonServerClient.callout('POST',
            '/api/kb/documents/' + EncodingUtil.urlEncode(documentId, 'UTF-8') + '/reindex',
            JSON.serialize(payload), 120000);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Reindex failed: ' + ArchonServerClient.extractServerError(res));
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        return parseDocument((Map<String, Object>) body.get('document'));
    }

    @AuraEnabled
    public static void deleteDocument(String documentId) {
        HttpResponse res = ArchonServerClient.callout('DELETE',
            '/api/kb/documents/' + EncodingUtil.urlEncode(documentId, 'UTF-8'), null);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Delete failed: ' + ArchonServerClient.extractServerError(res));
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /** Embeddings always go through OpenAI — reuse the org/user's own key when one is configured. */
    private static Map<String, Object> buildEmbeddingEngineOverride() {
        AiEngineConnection__c cred = AiEngineConnectionController.resolveForRuntime('openai', null);
        if (cred == null) return null;
        return new Map<String, Object>{
            'engineType'   => cred.EngineType__c,
            'apiKey'       => cred.ApiKey__c,
            'endpoint'     => cred.Endpoint__c,
            'defaultModel' => cred.DefaultModel__c,
            'connectionId' => cred.Id
        };
    }

    private static KbDocumentDto parseDocument(Map<String, Object> d) {
        if (d == null) return null;
        KbDocumentDto dto = new KbDocumentDto();
        dto.id = (String) d.get('id');
        dto.title = (String) d.get('title');
        dto.sourceType = (String) d.get('sourceType');
        dto.status = (String) d.get('status');
        dto.chunkCount = d.get('chunkCount') != null ? Integer.valueOf((Object) d.get('chunkCount')) : 0;
        dto.errorMessage = (String) d.get('errorMessage');
        return dto;
    }

    // ── Wrappers ─────────────────────────────────────────────────────

    public class StorageConfig {
        @AuraEnabled public String backend;
        @AuraEnabled public String connectionUrlMasked;
        @AuraEnabled public Boolean hasConnectionUrl;
    }

    public class KbDocumentDto {
        @AuraEnabled public String id;
        @AuraEnabled public String title;
        @AuraEnabled public String sourceType;
        @AuraEnabled public String status;
        @AuraEnabled public Integer chunkCount;
        @AuraEnabled public String errorMessage;
    }
}
