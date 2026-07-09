/**
 * SynapseSetupController — drives the one-time app-level OAuth setup.
 *
 * Master-token model (no pickup roundtrip):
 *   1. LWC mount → getStatus() returns whether Setup is complete (local read).
 *   2. Admin clicks Authorize → startSetup(returnUrl):
 *      Apex calls /api/setup/authorize-url, gets back BOTH authorizeUrl AND
 *      a pre-minted sessionKey. Apex stashes sessionKey on SynapseInstall__c
 *      immediately. Returns the authorize URL to the LWC.
 *   3. LWC redirects browser to authorize URL → user logs in / consents →
 *      SF redirects to <server>/api/setup/callback → server completes OAuth
 *      → server promotes the pre-minted sessionKey into an OrgInstall row
 *      → server redirects browser to returnUrl?synapse_setup=1.
 *   4. LWC sees the flag, calls refreshStatus() to enrich the local Custom
 *      Setting with email + configuredAt. No second OAuth callout.
 *   5. From here on, AgentConnectorController.callout() sends
 *      Authorization: Bearer <SessionKey__c>.
 *
 * Reset blows away the local Custom Setting AND tells the server to drop
 * the OrgInstall row.
 */
public with sharing class SynapseSetupController {

    private static final Integer CALLOUT_TIMEOUT_MS = 25000;

    @AuraEnabled
    public static SetupStatus getStatus() {
        SynapseInstall__c row = SynapseInstall__c.getOrgDefaults();
        SetupStatus s = new SetupStatus();
        s.configured        = row != null && String.isNotBlank(row.SessionKey__c) && row.ConfiguredAt__c != null;
        s.configuredAt      = row != null ? row.ConfiguredAt__c       : null;
        s.configuredByEmail = row != null ? row.ConfiguredByEmail__c  : null;
        s.orgId             = UserInfo.getOrganizationId();
        return s;
    }

    /**
     * Hits the server for authoritative status + email. Called by the LWC
     * after it sees ?synapse_setup=1 to enrich the local Custom Setting
     * with the configured email and confirmed timestamp.
     */
    @AuraEnabled
    public static SetupStatus refreshStatus() {
        Map<String, Object> body = new Map<String, Object>{
            'orgId' => UserInfo.getOrganizationId()
        };
        HttpResponse res = callout('POST', '/api/setup/status', JSON.serialize(body));
        if (res.getStatusCode() >= 400) {
            return getStatus();
        }
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        Boolean configured = (Boolean) parsed.get('configured');
        if (configured == true) {
            SynapseInstall__c row = SynapseInstall__c.getOrgDefaults();
            if (row == null) row = new SynapseInstall__c(SetupOwnerId = UserInfo.getOrganizationId());
            String email = (String) parsed.get('email');
            if (String.isNotBlank(email)) row.ConfiguredByEmail__c = email;
            if (row.ConfiguredAt__c == null) row.ConfiguredAt__c = System.now();
            upsert row;
        }
        return getStatus();
    }

    @AuraEnabled
    public static StartResult startSetup(String returnUrl) {
        if (String.isBlank(returnUrl)) {
            throw new AuraHandledException('returnUrl is required.');
        }

        Map<String, Object> body = new Map<String, Object>{
            'orgId'         => UserInfo.getOrganizationId(),
            'userId'        => UserInfo.getUserId(),
            'sfMyDomainUrl' => URL.getOrgDomainUrl().toExternalForm(),
            'returnUrl'     => returnUrl
        };

        HttpResponse res = callout('POST', '/api/setup/authorize-url', JSON.serialize(body));
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Could not start setup: ' + res.getBody());
        }
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());

        String sessionKey  = (String) parsed.get('sessionKey');
        String authorizeUrl = (String) parsed.get('authorizeUrl');
        if (String.isBlank(sessionKey) || String.isBlank(authorizeUrl)) {
            throw new AuraHandledException('Malformed server response from authorize-url.');
        }

        // Stash the sessionKey RIGHT NOW. It's inactive until the OAuth callback
        // promotes it into an OrgInstall row on the server. If the user
        // abandons the flow, a future callout will get 401 invalid_session
        // and the LWC will prompt them to retry Setup.
        SynapseInstall__c row = SynapseInstall__c.getOrgDefaults();
        if (row == null) row = new SynapseInstall__c(SetupOwnerId = UserInfo.getOrganizationId());
        row.SessionKey__c        = sessionKey;
        // Clear stale activation metadata — refreshStatus() fills it after OAuth.
        row.ConfiguredAt__c      = null;
        row.ConfiguredByEmail__c = null;
        upsert row;

        StartResult r = new StartResult();
        r.authorizeUrl = authorizeUrl;
        return r;
    }

    @AuraEnabled
    public static void resetSetup() {
        SynapseInstall__c row = SynapseInstall__c.getOrgDefaults();
        String sessionKey = row != null ? row.SessionKey__c : null;

        if (String.isNotBlank(sessionKey)) {
            Map<String, Object> body = new Map<String, Object>{
                'orgId'      => UserInfo.getOrganizationId(),
                'sessionKey' => sessionKey
            };
            try {
                callout('POST', '/api/setup/reset', JSON.serialize(body));
            } catch (Exception e) { /* best effort */ }
        }
        if (row != null) {
            row.SessionKey__c        = null;
            row.ConfiguredAt__c      = null;
            row.ConfiguredByEmail__c = null;
            upsert row;
        }
    }

    @TestVisible
    private static HttpResponse callout(String method, String path, String body) {
        String base = getServerUrl();
        if (String.isBlank(base)) {
            throw new AuraHandledException(
                'Synapse Config ServerUrl__c is not set. Setup → Custom Metadata Types → Synapse Config → Manage Records → Default → edit ServerUrl__c.'
            );
        }
        HttpRequest req = new HttpRequest();
        req.setEndpoint(base.removeEnd('/') + path);
        req.setMethod(method);
        req.setHeader('Content-Type', 'application/json');
        if (String.isNotBlank(body)) req.setBody(body);
        req.setTimeout(CALLOUT_TIMEOUT_MS);
        return new Http().send(req);
    }

    private static String getServerUrl() {
        List<SynapseConfig__mdt> rows = [
            SELECT ServerUrl__c FROM SynapseConfig__mdt WHERE DeveloperName = 'Default' LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0].ServerUrl__c;
    }

    public class SetupStatus {
        @AuraEnabled public Boolean  configured;
        @AuraEnabled public DateTime configuredAt;
        @AuraEnabled public String   configuredByEmail;
        @AuraEnabled public String   orgId;
    }

    public class StartResult {
        @AuraEnabled public String authorizeUrl;
    }
}
