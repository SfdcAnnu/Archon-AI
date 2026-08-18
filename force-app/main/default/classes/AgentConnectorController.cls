/**
 * AgentConnectorController — server-proxy thin layer.
 *
 * Tokens, OAuth client_id/secret, and refresh logic all live on the Synapse
 * Node server now. This class is just a JWT-authenticated callout proxy so
 * the LWC has cacheable Apex methods to wire against.
 *
 * Display metadata (icons, brand colors, descriptions, category labels)
 * still lives in ConnectorCatalog__mdt — pure SF config, no secrets.
 */
@SuppressWarnings('PMD.ApexCRUDViolation')
public with sharing class AgentConnectorController {

    // Apex max. Render free-tier services cold-start in 30-60s; the tool
    // catalog fetch traverses TWO of them (Node server → MCP server).
    private static final Integer CALLOUT_TIMEOUT_MS = 120000;

    // ── DIRECTORY ────────────────────────────────────────────────────

    /**
     * Returns every catalog entry decorated with the per-org connection
     * status fetched from the server.
     */
    @AuraEnabled(cacheable=true)
    public static List<DirectoryEntry> getDirectory() {
        Map<String, ServerConnector> byKey = listServerConnectors();
        List<ConnectorCatalog__mdt> catalog = [
            SELECT DeveloperName, MasterLabel, DisplayName__c, Description__c,
                   Category__c, IconStaticResource__c, BrandColor__c,
                   AuthType__c, MapsToCatalogType__c, IsPopular__c, SortOrder__c,
                   McpServerUrl__c
            FROM ConnectorCatalog__mdt
            ORDER BY SortOrder__c ASC, MasterLabel ASC
        ];

        List<DirectoryEntry> out = new List<DirectoryEntry>();
        for (ConnectorCatalog__mdt cat : catalog) {
            DirectoryEntry e = new DirectoryEntry();
            e.providerKey        = cat.DeveloperName;
            e.displayName        = cat.DisplayName__c != null ? cat.DisplayName__c : cat.MasterLabel;
            e.description        = cat.Description__c;
            e.category           = cat.Category__c;
            e.iconStaticResource = cat.IconStaticResource__c;
            e.brandColor         = cat.BrandColor__c;
            e.authType           = cat.AuthType__c;
            e.mapsToCatalogType  = cat.MapsToCatalogType__c;
            e.isPopular          = cat.IsPopular__c;
            e.mcpServerUrl       = cat.McpServerUrl__c;

            ServerConnector existing = byKey.get(cat.DeveloperName);
            if (existing != null) {
                e.connectorId      = existing.id;
                e.status           = existing.status;
                e.accountEmail     = existing.accountEmail;
                e.lastConnectedAt  = parseIso(existing.lastConnectedAt);
                e.lastErrorMessage = existing.lastErrorMessage;
            } else {
                e.status = 'NotConfigured';
            }
            out.add(e);
        }

        // Custom/client-added MCP servers — an open extension point alongside
        // the packaged (protected) catalog above. No OAuth handshake at this
        // layer: the URL is trusted directly, same as Claude's own "add a
        // custom MCP server" flow — any auth the server itself requires
        // happens when it's actually called.
        for (CustomMcpServer__c c : [
            SELECT Id, Name, McpServerUrl__c, Description__c, Category__c, CatalogType__c, IsActive__c
            FROM CustomMcpServer__c
            WHERE IsActive__c = true
            WITH USER_MODE
            ORDER BY Name ASC
        ]) {
            DirectoryEntry e = new DirectoryEntry();
            e.providerKey       = 'custom_' + c.Id;
            e.displayName       = c.Name;
            e.description       = c.Description__c;
            e.category          = c.Category__c;
            e.mapsToCatalogType = c.CatalogType__c;
            e.mcpServerUrl      = c.McpServerUrl__c;
            e.status            = 'Connected'; // no separate connect step — the URL itself is the config
            e.isCustom          = true;
            e.connectorId       = c.Id;
            out.add(e);
        }
        return out;
    }

    /**
     * Admin roster for the Salesforce access page — every user who has (or
     * attempted) their own "Connect my Salesforce" for PerUser-mode agents.
     * Distinct from getDirectory(), which is the org-level Setup connection.
     */
    @AuraEnabled(cacheable=true)
    public static List<UserConnection> listSalesforceUserConnections() {
        HttpResponse res = callout('GET', '/api/connectors/users?providerKey=salesforce_mcp', null);
        List<UserConnection> out = new List<UserConnection>();
        if (res.getStatusCode() >= 400) return out;
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        Object usersRaw = body.get('users');
        if (!(usersRaw instanceof List<Object>)) return out;

        Set<Id> userIds = new Set<Id>();
        List<Map<String, Object>> rows = new List<Map<String, Object>>();
        for (Object item : (List<Object>) usersRaw) {
            Map<String, Object> u = (Map<String, Object>) item;
            rows.add(u);
            String configuredBy = (String) u.get('configuredBy');
            if (String.isNotBlank(configuredBy)) {
                try { userIds.add((Id) configuredBy); } catch (Exception e) { /* not a valid Id — skip */ }
            }
        }
        Map<Id, User> usersById = new Map<Id, User>(
            userIds.isEmpty() ? new List<User>() : [SELECT Id, Name, Email FROM User WHERE Id IN :userIds WITH USER_MODE]
        );

        for (Map<String, Object> u : rows) {
            UserConnection uc = new UserConnection();
            String configuredBy = (String) u.get('configuredBy');
            User matchedUser = String.isNotBlank(configuredBy) ? usersById.get((Id) configuredBy) : null;
            uc.userName         = matchedUser != null ? matchedUser.Name : configuredBy;
            uc.userEmail         = matchedUser != null ? matchedUser.Email : null;
            uc.status            = (String) u.get('status');
            uc.accountEmail      = (String) u.get('accountEmail');
            uc.lastConnectedAt   = parseIso((String) u.get('lastConnectedAt'));
            uc.lastErrorMessage  = (String) u.get('lastErrorMessage');
            out.add(uc);
        }
        return out;
    }

    // ── CUSTOM MCP SERVERS ───────────────────────────────────────────
    // User/client-added servers — see DirectoryEntry.isCustom above for how
    // they surface in the same directory as the packaged catalog.

    @AuraEnabled(cacheable=true)
    public static List<CustomMcpServer__c> listCustomMcpServers() {
        return [
            SELECT Id, Name, McpServerUrl__c, Description__c, Category__c, CatalogType__c, IsActive__c
            FROM CustomMcpServer__c
            WITH USER_MODE
            ORDER BY Name ASC
        ];
    }

    @AuraEnabled
    public static Id saveCustomMcpServer(
        String recordId, String serverName, String mcpServerUrl,
        String description, String category, String catalogType
    ) {
        if (String.isBlank(serverName))   throw new AuraHandledException('Server name is required.');
        if (String.isBlank(mcpServerUrl)) throw new AuraHandledException('MCP Server URL is required.');
        if (String.isBlank(category))     throw new AuraHandledException('Category is required.');
        if (String.isBlank(catalogType))  throw new AuraHandledException('Catalog type is required.');

        CustomMcpServer__c rec = String.isNotBlank(recordId)
            ? new CustomMcpServer__c(Id = recordId)
            : new CustomMcpServer__c(IsActive__c = true);
        rec.Name             = serverName;
        rec.McpServerUrl__c  = mcpServerUrl;
        rec.Description__c   = description;
        rec.Category__c      = category;
        rec.CatalogType__c   = catalogType;

        upsert as user rec;
        return rec.Id;
    }

    @AuraEnabled
    public static void deleteCustomMcpServer(Id recordId) {
        if (recordId == null) throw new AuraHandledException('recordId is required.');
        delete as user new CustomMcpServer__c(Id = recordId);
    }

    /** For the properties-panel dropdown — connectors that power a given catalog type. */
    @AuraEnabled(cacheable=true)
    public static List<ConnectorOption> getConnectorsForCatalogType(String catalogType) {
        if (String.isBlank(catalogType)) return new List<ConnectorOption>();

        Set<String> providerKeys = new Set<String>();
        for (ConnectorCatalog__mdt cat : [
            SELECT DeveloperName, DisplayName__c
            FROM ConnectorCatalog__mdt
            WHERE MapsToCatalogType__c = :catalogType
        ]) {
            providerKeys.add(cat.DeveloperName);
        }
        if (providerKeys.isEmpty()) return new List<ConnectorOption>();

        Map<String, ServerConnector> byKey = listServerConnectors();
        List<ConnectorOption> options = new List<ConnectorOption>();
        for (String pkey : providerKeys) {
            ServerConnector c = byKey.get(pkey);
            if (c == null || c.status != 'Connected') continue;
            ConnectorOption o = new ConnectorOption();
            o.connectorId = c.id;
            o.providerKey = c.providerKey;
            o.label       = c.displayName + (String.isNotBlank(c.accountEmail) ? '  ·  ' + c.accountEmail : '');
            options.add(o);
        }
        return options;
    }

    /** Live tools/list from the standalone MCP server. Used by the properties panel. */
    @AuraEnabled(cacheable=true)
    public static List<RemoteTool> getConnectorTools(Id connectorId) {
        if (connectorId == null) return new List<RemoteTool>();
        HttpResponse res = callout('GET', '/api/connectors/' + connectorId + '/tools', null);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Could not load tools: ' + res.getBody());
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        List<RemoteTool> out = new List<RemoteTool>();
        for (Object item : (List<Object>) body.get('tools')) {
            Map<String, Object> t = (Map<String, Object>) item;
            RemoteTool rt = new RemoteTool();
            rt.name        = (String) t.get('name');
            rt.description = (String) t.get('description');
            rt.inputSchema = t.get('inputSchema') != null ? JSON.serialize(t.get('inputSchema')) : null;
            out.add(rt);
        }
        return out;
    }

    /**
     * AUTHENTICATED tools/list WITH real input schemas — for ANY provider,
     * not just Salesforce. Powers the "Call a Tool" action node's param-field
     * UI (schema-driven, same pattern as the custom-tools picker).
     */
    @AuraEnabled
    public static List<RemoteTool> getMcpToolSchemas(String providerKey, String connectorId) {
        if (String.isBlank(providerKey)) return new List<RemoteTool>();
        Map<String, Object> reqBody = new Map<String, Object>{ 'provider' => providerKey, 'userId' => UserInfo.getUserId() };
        // Non-Salesforce connectorIds are Node-side UUIDs, not Salesforce Ids —
        // kept as a plain String end to end (see resolveProviderToken on the server).
        if (String.isNotBlank(connectorId)) reqBody.put('connectorId', connectorId);
        HttpResponse res = callout('POST', '/api/mcp-tool-schemas', JSON.serialize(reqBody));
        throwIfServerWaking(res);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Could not load tool schemas: ' + res.getBody());
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        List<RemoteTool> out = new List<RemoteTool>();
        for (Object item : (List<Object>) body.get('tools')) {
            Map<String, Object> t = (Map<String, Object>) item;
            RemoteTool rt = new RemoteTool();
            rt.name        = (String) t.get('name');
            rt.description = (String) t.get('description');
            rt.inputSchema = t.get('inputSchema') != null ? JSON.serialize(t.get('inputSchema')) : null;
            out.add(rt);
        }
        return out;
    }

    /**
     * Public tool catalog for a provider — no auth against the MCP server
     * needed (its GET /tools is metadata-only). URL comes from
     * ConnectorCatalog__mdt.McpServerUrl__c; the Node companion proxies the
     * fetch so the org needs no extra Remote Site entries.
     */
    @AuraEnabled(cacheable=true)
    public static List<McpToolSummary> getMcpToolCatalog(String providerKey) {
        if (String.isBlank(providerKey)) return new List<McpToolSummary>();
        List<ConnectorCatalog__mdt> rows = [
            SELECT McpServerUrl__c FROM ConnectorCatalog__mdt
            WHERE DeveloperName = :providerKey LIMIT 1
        ];
        if (rows.isEmpty() || String.isBlank(rows[0].McpServerUrl__c)) {
            return new List<McpToolSummary>();
        }
        HttpResponse res = callout('POST', '/api/mcp-tools',
            JSON.serialize(new Map<String, Object>{ 'url' => rows[0].McpServerUrl__c }));
        throwIfServerWaking(res);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Could not load tool catalog: ' + res.getBody());
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        List<McpToolSummary> out = new List<McpToolSummary>();
        for (Object item : (List<Object>) body.get('tools')) {
            Map<String, Object> t = (Map<String, Object>) item;
            McpToolSummary s = new McpToolSummary();
            s.name        = (String) t.get('name');
            s.description = (String) t.get('description');
            s.readOnly    = t.get('readOnly') == true;
            out.add(s);
        }
        return out;
    }

    // ── CUSTOM TOOLS (org's own Apex actions / Flows) ─────────────────

    /**
     * Lists the org's invocable Apex actions + autolaunched Flows for the
     * custom-tool picker. Returns the server's raw JSON — the LWC parses
     * it (primitive return avoids wrapper-deserialization pitfalls).
     */
    @AuraEnabled
    public static String getCustomActionCatalog() {
        HttpResponse res = callout('POST', '/api/sf/custom-actions',
            JSON.serialize(new Map<String, Object>{ 'mode' => 'list' }));
        throwIfServerWaking(res);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Could not load custom actions: ' + res.getBody());
        }
        return res.getBody();
    }

    /** Input/output schema of one action — powers the picker's preview pane. */
    @AuraEnabled
    public static String describeCustomAction(String actionType, String name) {
        HttpResponse res = callout('POST', '/api/sf/custom-actions',
            JSON.serialize(new Map<String, Object>{
                'mode' => 'describe', 'type' => actionType, 'name' => name
            }));
        throwIfServerWaking(res);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Could not describe action: ' + res.getBody());
        }
        return res.getBody();
    }

    // ── APPROVAL PROCESSES (native — org's own, already configured) ────

    public class ApprovalProcessOption {
        // "id" here is deliberately the process's unique DeveloperName, not
        // ProcessDefinition.Id — confirmed against a real org that the
        // Submit REST API's processDefinitionNameOrId only accepts the
        // unique name (or a different Id than ProcessDefinition.Id exposes);
        // passing ProcessDefinition.Id fails with NO_APPLICABLE_PROCESS even
        // though the same process is found fine when omitted entirely.
        @AuraEnabled public String id;
        @AuraEnabled public String name;
        @AuraEnabled public String label;
    }

    /**
     * Active native Approval Processes, for the Approval node's picker.
     * Pure Apex SOQL — no Node server round trip, since this metadata lives
     * in Salesforce itself. Filtered to one object when the agent has a
     * trigger object (flow-mode); unfiltered for chat-mode agents (no
     * single implied object), matching the ask to show everything active.
     *
     * TableEnumOrId is the object's own API name for standard objects
     * (confirmed against a real org — e.g. "Opportunity") but is reported
     * to be the object's own (CustomObject) Id for custom objects rather
     * than "MyObject__c" — not yet verified against a real custom-object
     * approval process, so custom-object filtering may need adjustment
     * once one is tested.
     */
    @AuraEnabled(cacheable=true)
    public static List<ApprovalProcessOption> getApprovalProcesses(String objectType) {
        List<SObject> defs = Database.query(
            'SELECT Id, Name, DeveloperName, TableEnumOrId FROM ProcessDefinition ' +
            'WHERE Type = \'Approval\' AND State = \'Active\' ORDER BY Name'
        );
        List<ApprovalProcessOption> out = new List<ApprovalProcessOption>();
        for (SObject s : defs) {
            if (String.isNotBlank(objectType) && (String) s.get('TableEnumOrId') != objectType) continue;
            ApprovalProcessOption opt = new ApprovalProcessOption();
            opt.id = (String) s.get('DeveloperName');
            opt.name = (String) s.get('Name');
            opt.label = (String) s.get('Name');
            out.add(opt);
        }
        return out;
    }

    /**
     * Free-tier Render sleeps idle services; while one wakes (~30-60s) its
     * edge answers requests with an HTML "Application loading" page. Turn
     * that into a machine-readable signal the LWCs auto-retry on, instead
     * of dumping raw HTML at the user.
     */
    private static void throwIfServerWaking(HttpResponse res) {
        String body = res.getBody();
        Boolean htmlBody = body != null && body.trim().startsWith('<');
        if (htmlBody || res.getStatusCode() == 502 || res.getStatusCode() == 503) {
            throw new AuraHandledException('SERVER_WAKING: The Archon server is waking up from idle — this usually takes under a minute.');
        }
    }

    // ── OAUTH START / DISCONNECT ──────────────────────────────────────

    /**
     * Asks the server to mint an OAuth authorize URL. LWC navigates the
     * browser to that URL; the server's /api/oauth/callback closes the loop.
     */
    @AuraEnabled
    public static StartOAuthResult startOAuth(String providerKey, String displayName, String returnUrl) {
        Map<String, Object> body = new Map<String, Object>{
            'providerKey' => providerKey,
            'displayName' => String.isBlank(displayName) ? providerKey : displayName,
            'returnUrl'   => returnUrl,
            // Connections are per user — the server keys tokens by this id.
            'userId'      => UserInfo.getUserId()
        };
        HttpResponse res = callout('POST', '/api/connectors/oauth/start', JSON.serialize(body));
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('OAuth start failed: ' + res.getBody());
        }
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        StartOAuthResult r = new StartOAuthResult();
        r.connectorId  = (String) parsed.get('connectorId');
        r.authorizeUrl = (String) parsed.get('authorizeUrl');
        return r;
    }

    @AuraEnabled
    public static void disconnect(Id connectorId) {
        HttpResponse res = callout('DELETE', '/api/connectors/' + connectorId, null);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Disconnect failed: ' + res.getBody());
        }
    }

    // ── CALLOUT PLUMBING ──────────────────────────────────────────────

    private static HttpResponse callout(String method, String path, String body) {
        SynapseInstall__c install = SynapseInstall__c.getOrgDefaults();
        if (install == null || String.isBlank(install.SessionKey__c)) {
            throw new AuraHandledException('Synapse is not set up yet. Open Synapse Setup and click Authorize first.');
        }
        String base = getServerUrl();
        if (String.isBlank(base)) {
            throw new AuraHandledException(
                'Synapse Config ServerUrl__c is not set. Setup → Custom Metadata Types → Synapse Config → Manage Records → Default → edit ServerUrl__c.'
            );
        }
        HttpRequest req = new HttpRequest();
        req.setEndpoint(base.removeEnd('/') + path);
        req.setMethod(method);
        req.setHeader('Authorization', 'Bearer ' + install.SessionKey__c);
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

    /**
     * Set true whenever listServerConnectors couldn't actually reach the
     * Archon server (idle Render service waking, etc.). Callers that show
     * connection STATUS to a user should check this after getDirectory():
     * an empty connector map from an unreachable server is NOT the same as
     * "nothing is connected", but the silent-empty fallback below renders
     * exactly like it. Static (per-transaction) rather than a changed
     * return shape so no existing caller needs touching.
     */
    public static Boolean directoryServerUnreachable = false;

    private static Map<String, ServerConnector> listServerConnectors() {
        directoryServerUnreachable = false;
        HttpResponse res = callout('GET', '/api/connectors', null);
        Map<String, ServerConnector> result = new Map<String, ServerConnector>();
        String rawBody = res.getBody();
        Boolean htmlBody = rawBody != null && rawBody.trim().startsWith('<');
        if (res.getStatusCode() >= 400 || htmlBody) {
            directoryServerUnreachable = true;
            return result;
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        Object connectorsRaw = body.get('connectors');
        if (!(connectorsRaw instanceof List<Object>)) return result;
        for (Object item : (List<Object>) connectorsRaw) {
            Map<String, Object> c = (Map<String, Object>) item;
            ServerConnector sc = new ServerConnector();
            sc.id               = (String) c.get('id');
            sc.providerKey      = (String) c.get('providerKey');
            sc.displayName      = (String) c.get('displayName');
            sc.status           = (String) c.get('status');
            sc.accountEmail     = (String) c.get('accountEmail');
            sc.lastConnectedAt  = (String) c.get('lastConnectedAt');
            sc.lastErrorMessage = (String) c.get('lastErrorMessage');
            result.put(sc.providerKey, sc);
        }
        return result;
    }

    private static DateTime parseIso(String iso) {
        if (String.isBlank(iso)) return null;
        try { return (DateTime) JSON.deserialize('"' + iso + '"', DateTime.class); }
        catch (Exception e) { return null; }
    }

    // ── WRAPPERS ─────────────────────────────────────────────────────

    public class DirectoryEntry {
        @AuraEnabled public String   providerKey;
        @AuraEnabled public String   displayName;
        @AuraEnabled public String   description;
        @AuraEnabled public String   category;
        @AuraEnabled public String   iconStaticResource;
        @AuraEnabled public String   brandColor;
        @AuraEnabled public String   authType;
        @AuraEnabled public String   mapsToCatalogType;
        @AuraEnabled public Boolean  isPopular;
        @AuraEnabled public String   mcpServerUrl;
        @AuraEnabled public String   connectorId;
        @AuraEnabled public String   status;
        @AuraEnabled public String   accountEmail;
        @AuraEnabled public DateTime lastConnectedAt;
        @AuraEnabled public String   lastErrorMessage;
        @AuraEnabled public Boolean  isCustom;
    }

    public class ConnectorOption {
        @AuraEnabled public String connectorId;
        @AuraEnabled public String providerKey;
        @AuraEnabled public String label;
    }

    public class StartOAuthResult {
        @AuraEnabled public String connectorId;
        @AuraEnabled public String authorizeUrl;
    }

    public class RemoteTool {
        @AuraEnabled public String name;
        @AuraEnabled public String description;
        @AuraEnabled public String inputSchema; // JSON-encoded
    }

    public class McpToolSummary {
        @AuraEnabled public String  name;
        @AuraEnabled public String  description;
        @AuraEnabled public Boolean readOnly;
    }

    public class UserConnection {
        @AuraEnabled public String   userName;
        @AuraEnabled public String   userEmail;
        @AuraEnabled public String   status;
        @AuraEnabled public String   accountEmail;
        @AuraEnabled public DateTime lastConnectedAt;
        @AuraEnabled public String   lastErrorMessage;
    }

    private class ServerConnector {
        String id;
        String providerKey;
        String displayName;
        String status;
        String accountEmail;
        String lastConnectedAt;
        String lastErrorMessage;
    }
}
