/**
 * AiEngineConnectionController — CRUD + resolution + validation for
 * AiEngineConnection__c records.
 *
 * Ownership model:
 *   • Personal: OwnerId = running user, only they see it (Private sharing).
 *   • Shared:   admin creates, then shares via standard Sharing button OR
 *               toggles IsPublicShared__c which grants Read to everyone.
 *
 * Runtime resolution (used by AgentChatController.sendTurn):
 *   1. Running user's IsPreferred + IsActive Personal for engine
 *   2. Any IsActive Personal for engine
 *   3. Node-bound connection on the AI node (if user has access)
 *   4. Any Shared connection accessible to the user for engine
 *   5. null → caller falls back to Node .env
 */
@SuppressWarnings('PMD.ApexCRUDViolation')
public with sharing class AiEngineConnectionController {

    // ── LIST ──────────────────────────────────────────────────────

    /** All connections the running user can see for a given engine (Personal + Shared). */
    @AuraEnabled(cacheable=true)
    public static List<ConnectionSummary> listAccessibleForEngine(String engineType) {
        List<ConnectionSummary> out = new List<ConnectionSummary>();
        for (AiEngineConnection__c c : [
            SELECT Id, Name, Label__c, User__c, User__r.Name, OwnershipType__c, EngineType__c,
                   Endpoint__c, DefaultModel__c, IsActive__c, IsPreferred__c,
                   ValidationStatus__c, LastValidatedAt__c, LastUsedAt__c, IsPublicShared__c,
                   OwnerId
            FROM AiEngineConnection__c
            WHERE EngineType__c = :engineType
            WITH USER_MODE
            ORDER BY IsPreferred__c DESC, LastUsedAt__c DESC NULLS LAST, LastModifiedDate DESC
            LIMIT 100
        ]) {
            out.add(toSummary(c));
        }
        return out;
    }

    /** All engines the running user has access to at least one active connection for. */
    @AuraEnabled(cacheable=true)
    public static List<String> listAvailableEngines() {
        Set<String> engines = new Set<String>();
        for (AiEngineConnection__c c : [
            SELECT EngineType__c FROM AiEngineConnection__c
            WHERE IsActive__c = true
            WITH USER_MODE
            LIMIT 500
        ]) {
            if (c.EngineType__c != null) engines.add(c.EngineType__c);
        }
        return new List<String>(engines);
    }

    // ── SAVE ──────────────────────────────────────────────────────

    /**
     * Upsert a connection. Enforces:
     *   • Only one IsPreferred=true per (user, engine)
     *   • IsPublicShared__c editable only by users with the Admin perm set
     *   • On save, ValidationStatus__c defaults to Untested
     */
    /**
     * Primitive-only signature — no wrapper class.
     *
     * LWC-to-Apex wrapper deserialization has been observed to lose fields
     * silently in some managed-package + Lightning cache combinations, so we
     * pass every field as its own parameter. Bulletproof, if slightly verbose.
     */
    @AuraEnabled
    public static Id saveConnection(
        String recordId,
        String engineType,
        String ownershipType,
        String labelText,
        String apiKey,
        String endpoint,
        String defaultModel,
        Boolean isActive,
        Boolean isPreferred,
        Boolean isPublicShared,
        String notes
    ) {
        if (String.isBlank(engineType)) throw new AuraHandledException('Engine type is required.');
        if (String.isBlank(labelText))  throw new AuraHandledException('Label is required.');
        if (String.isBlank(apiKey) && String.isBlank(recordId)) {
            throw new AuraHandledException('API key is required for new connections.');
        }

        AiEngineConnection__c rec;
        Boolean isNew = String.isBlank(recordId);
        if (isNew) {
            rec = new AiEngineConnection__c(
                User__c             = UserInfo.getUserId(),
                OwnershipType__c    = String.isBlank(ownershipType) ? 'Personal' : ownershipType,
                EngineType__c       = engineType,
                Label__c            = labelText,
                Endpoint__c         = endpoint,
                DefaultModel__c     = defaultModel,
                IsActive__c         = isActive == null ? true : isActive,
                IsPreferred__c      = isPreferred == null ? false : isPreferred,
                IsPublicShared__c   = isPublicShared == null ? false : isPublicShared,
                Notes__c            = notes,
                ValidationStatus__c = 'Untested'
            );
            rec.ApiKey__c = apiKey;
        } else {
            rec = [
                SELECT Id, User__c, OwnershipType__c, EngineType__c, Label__c,
                       Endpoint__c, DefaultModel__c, IsActive__c, IsPreferred__c,
                       IsPublicShared__c, Notes__c, ValidationStatus__c
                FROM AiEngineConnection__c WHERE Id = :recordId WITH USER_MODE LIMIT 1
            ];
            if (labelText != null)      rec.Label__c        = labelText;
            if (endpoint != null)       rec.Endpoint__c     = endpoint;
            if (defaultModel != null)   rec.DefaultModel__c = defaultModel;
            if (isActive != null)       rec.IsActive__c     = isActive;
            if (isPreferred != null)    rec.IsPreferred__c  = isPreferred;
            if (isPublicShared != null) rec.IsPublicShared__c = isPublicShared;
            if (notes != null)          rec.Notes__c        = notes;
            if (String.isNotBlank(apiKey)) {
                rec.ApiKey__c            = apiKey;
                rec.ValidationStatus__c  = 'Untested';
                rec.LastValidatedAt__c   = null;
            }
        }

        if (rec.IsPreferred__c == true) {
            List<AiEngineConnection__c> others = [
                SELECT Id FROM AiEngineConnection__c
                WHERE User__c = :UserInfo.getUserId()
                  AND EngineType__c = :rec.EngineType__c
                  AND Id != :rec.Id
                  AND IsPreferred__c = true
                WITH USER_MODE
            ];
            for (AiEngineConnection__c o : others) o.IsPreferred__c = false;
            if (!others.isEmpty()) update others;
        }

        if (isNew) insert rec; else update rec;
        return rec.Id;
    }

    // ── DELETE ────────────────────────────────────────────────────

    @AuraEnabled
    public static void deleteConnection(Id recordId) {
        if (recordId == null) throw new AuraHandledException('recordId is required.');
        AiEngineConnection__c rec = [SELECT Id FROM AiEngineConnection__c WHERE Id = :recordId WITH USER_MODE LIMIT 1];
        delete rec;
    }

    // ── BIND to AI node ───────────────────────────────────────────

    @AuraEnabled
    public static void bindToNode(Id agentNodeId, Id connectionId) {
        if (agentNodeId == null) throw new AuraHandledException('agentNodeId is required.');
        AgentNode__c n = [SELECT Id, AiEngineConnection__c FROM AgentNode__c WHERE Id = :agentNodeId WITH USER_MODE LIMIT 1];
        n.AiEngineConnection__c = connectionId;   // may be null to clear
        update n;
    }

    // ── TEST ──────────────────────────────────────────────────────

    /**
     * Test the connection with a tiny "hello" prompt to the provider.
     * Delegates to the Node server (which has the network access + provider SDKs).
     */
    @AuraEnabled
    public static TestResult testConnection(Id recordId) {
        AiEngineConnection__c rec = [
            SELECT Id, EngineType__c, ApiKey__c, Endpoint__c, DefaultModel__c
            FROM AiEngineConnection__c WHERE Id = :recordId WITH USER_MODE LIMIT 1
        ];

        SynapseInstall__c install = getInstall();
        String base = getServerUrl();
        if (install == null || String.isBlank(install.SessionKey__c) || String.isBlank(base)) {
            throw new AuraHandledException('Archon setup incomplete. Complete Archon Setup before testing.');
        }

        Map<String, Object> body = new Map<String, Object>{
            'engineType'   => rec.EngineType__c,
            'apiKey'       => rec.ApiKey__c,
            'endpoint'     => rec.Endpoint__c,
            'defaultModel' => rec.DefaultModel__c
        };
        HttpRequest req = new HttpRequest();
        req.setEndpoint(base.removeEnd('/') + '/api/engine/test');
        req.setMethod('POST');
        req.setHeader('Authorization', 'Bearer ' + install.SessionKey__c);
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(body));
        req.setTimeout(15000);
        HttpResponse res = new Http().send(req);

        TestResult r = new TestResult();
        if (res.getStatusCode() == 200) {
            r.success = true;
            r.message = 'Connection OK.';
            rec.ValidationStatus__c = 'Success';
            rec.LastValidatedAt__c  = System.now();
        } else {
            r.success = false;
            r.message = extractServerError(res);
            rec.ValidationStatus__c = 'Failed';
        }
        update rec;
        return r;
    }

    // ── RESOLVE — used by AgentChatController.sendTurn ────────────

    /**
     * Runs the resolution chain and returns the ID of the connection the
     * caller should use (or null → fall back to Node .env).
     *
     * Order:
     *   1. Running user's Preferred + Active Personal for engineType
     *   2. Any Active Personal for the running user + engineType
     *   3. Node-bound connection (if user has access)
     *   4. Any Shared connection accessible to the user for engineType
     */
    public static AiEngineConnection__c resolveForRuntime(String engineType, Id nodeBoundId) {
        Id userId = UserInfo.getUserId();

        // 1 & 2 — Personal, prefer IsPreferred
        List<AiEngineConnection__c> personal = [
            SELECT Id, EngineType__c, ApiKey__c, Endpoint__c, DefaultModel__c, IsPreferred__c, User__c
            FROM AiEngineConnection__c
            WHERE User__c = :userId
              AND EngineType__c = :engineType
              AND OwnershipType__c = 'Personal'
              AND IsActive__c = true
            WITH USER_MODE
            ORDER BY IsPreferred__c DESC, LastUsedAt__c DESC NULLS LAST
            LIMIT 1
        ];
        if (!personal.isEmpty()) return personal[0];

        // 3 — Node-bound
        if (nodeBoundId != null) {
            List<AiEngineConnection__c> bound = [
                SELECT Id, EngineType__c, ApiKey__c, Endpoint__c, DefaultModel__c, User__c
                FROM AiEngineConnection__c
                WHERE Id = :nodeBoundId AND IsActive__c = true
                WITH USER_MODE
                LIMIT 1
            ];
            if (!bound.isEmpty()) return bound[0];
        }

        // 4 — Shared
        List<AiEngineConnection__c> shared = [
            SELECT Id, EngineType__c, ApiKey__c, Endpoint__c, DefaultModel__c, User__c
            FROM AiEngineConnection__c
            WHERE OwnershipType__c = 'Shared'
              AND EngineType__c = :engineType
              AND IsActive__c = true
            WITH USER_MODE
            ORDER BY LastUsedAt__c DESC NULLS LAST
            LIMIT 1
        ];
        if (!shared.isEmpty()) return shared[0];

        return null;
    }

    /** Called by AgentChatController after a successful turn. */
    public static void touchLastUsed(Id connectionId) {
        if (connectionId == null) return;
        update new AiEngineConnection__c(Id = connectionId, LastUsedAt__c = System.now());
    }

    // ── HELPERS ───────────────────────────────────────────────────

    private static ConnectionSummary toSummary(AiEngineConnection__c c) {
        ConnectionSummary s = new ConnectionSummary();
        s.id               = c.Id;
        s.name             = c.Name;
        s.label            = c.Label__c;
        s.userName         = c.User__r != null ? c.User__r.Name : null;
        s.ownershipType    = c.OwnershipType__c;
        s.engineType       = c.EngineType__c;
        s.endpoint         = c.Endpoint__c;
        s.defaultModel     = c.DefaultModel__c;
        s.isActive         = c.IsActive__c == true;
        s.isPreferred      = c.IsPreferred__c == true;
        s.isPublicShared   = c.IsPublicShared__c == true;
        s.isMine           = c.OwnerId == UserInfo.getUserId();
        s.validationStatus = c.ValidationStatus__c;
        s.lastValidatedAt  = c.LastValidatedAt__c;
        s.lastUsedAt       = c.LastUsedAt__c;
        return s;
    }

    private static SynapseInstall__c getInstall() {
        // API name stays SynapseInstall__c until packaging (namespace auto-prefixes).
        return SynapseInstall__c.getOrgDefaults();
    }

    private static String getServerUrl() {
        // Backward-compat: SynapseConfig__mdt still the API name until packaging.
        List<SynapseConfig__mdt> rows = [
            SELECT ServerUrl__c FROM SynapseConfig__mdt WHERE DeveloperName = 'Default' LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0].ServerUrl__c;
    }

    private static String extractServerError(HttpResponse res) {
        String raw = res.getBody();
        if (String.isBlank(raw)) return 'Server error ' + res.getStatusCode();
        try {
            Map<String, Object> j = (Map<String, Object>) JSON.deserializeUntyped(raw);
            if (j.containsKey('message') && j.get('message') != null) return (String) j.get('message');
        } catch (Exception e) { /* not JSON */ }
        return raw.length() > 400 ? raw.left(400) + '…' : raw;
    }

    // ── WRAPPERS ──────────────────────────────────────────────────

    public class ConnectionInput {
        @AuraEnabled public String recordId;
        @AuraEnabled public String ownershipType;
        @AuraEnabled public String engineType;
        @AuraEnabled public String label;
        @AuraEnabled public String apiKey;
        @AuraEnabled public String endpoint;
        @AuraEnabled public String defaultModel;
        @AuraEnabled public Boolean isActive;
        @AuraEnabled public Boolean isPreferred;
        @AuraEnabled public Boolean isPublicShared;
        @AuraEnabled public String notes;
    }

    public class ConnectionSummary {
        @AuraEnabled public Id       id;
        @AuraEnabled public String   name;
        @AuraEnabled public String   label;
        @AuraEnabled public String   userName;
        @AuraEnabled public String   ownershipType;
        @AuraEnabled public String   engineType;
        @AuraEnabled public String   endpoint;
        @AuraEnabled public String   defaultModel;
        @AuraEnabled public Boolean  isActive;
        @AuraEnabled public Boolean  isPreferred;
        @AuraEnabled public Boolean  isPublicShared;
        @AuraEnabled public Boolean  isMine;
        @AuraEnabled public String   validationStatus;
        @AuraEnabled public DateTime lastValidatedAt;
        @AuraEnabled public DateTime lastUsedAt;
    }

    public class TestResult {
        @AuraEnabled public Boolean success;
        @AuraEnabled public String  message;
    }
}
