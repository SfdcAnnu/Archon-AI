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

    private static final Integer CALLOUT_TIMEOUT_MS = 25000;

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
        return out;
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
            'returnUrl'   => returnUrl
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

    private static Map<String, ServerConnector> listServerConnectors() {
        HttpResponse res = callout('GET', '/api/connectors', null);
        Map<String, ServerConnector> result = new Map<String, ServerConnector>();
        if (res.getStatusCode() >= 400) return result;
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
