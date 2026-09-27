/**
 * ArchonWakeService — "Wake servers" for the Setup page.
 *
 * Free-tier Render sleeps idle services, and an agent run crosses at least
 * two of them (the Archon server, then each MCP server a tool lives on).
 * Left alone, the FIRST tool call of a run pays every cold start in series
 * — and a 120s Apex callout ceiling turns that into a failed run. This
 * service lets an admin trigger all those wake-ups up front, from one
 * button, and watch each service come online.
 *
 * One call = one shallow probe of everything, no waiting:
 *   1. GET <ServerUrl>/health — proves the Archon server is awake (and
 *      which build). A cold host answers this with 502/503 or an HTML
 *      "loading" page within seconds; that IS the wake-up trigger.
 *   2. Only once the Archon server answers: POST /api/connectors/wake with
 *      every MCP server URL the org knows (packaged catalog + custom
 *      servers). The Node side probes them in parallel (~12s cap each) so
 *      the org needs no Remote Site entry per MCP host.
 *
 * The browser polls this every few seconds until nothing reports
 * 'waking' — so no single request ever sits on a cold start.
 */
public with sharing class ArchonWakeService {

    private static final Integer HEALTH_TIMEOUT_MS = 30000;
    private static final Integer FANOUT_TIMEOUT_MS = 30000;

    public class ServiceState {
        public String key;
        public String name;
        public String url;
        /** 'online' | 'waking' | 'unreachable' | 'pending' (not probed yet) */
        public String status;
        public Integer ms;
        public String message;
    }

    public class WakeResult {
        public ServiceState archon;
        public List<ServiceState> targets = new List<ServiceState>();
        /** Whether the org-level Archon session exists — without it the MCP fan-out cannot run. */
        public Boolean configured;
    }

    public class NotConfiguredException extends Exception {}

    public static WakeResult wake() {
        String base = getServerUrl();
        if (String.isBlank(base)) {
            throw new NotConfiguredException(
                'Synapse Config ServerUrl__c is not set. Setup → Custom Metadata Types → Synapse Config → Manage Records → Default → edit ServerUrl__c.'
            );
        }
        base = base.removeEnd('/');

        WakeResult out = new WakeResult();
        SynapseInstall__c install = SynapseInstall__c.getOrgDefaults();
        out.configured = install != null && String.isNotBlank(install.SessionKey__c);
        out.archon = probeArchon(base);
        out.targets = collectTargets();

        if (out.targets.isEmpty()) return out;

        if (out.archon.status != 'online') {
            markAll(out.targets, 'pending', 'Waiting for the Archon server to answer first.');
            return out;
        }
        if (!out.configured) {
            markAll(out.targets, 'pending', 'Authorize the Archon connection first — the MCP probe runs through it.');
            return out;
        }
        fanOut(out.targets);
        return out;
    }

    // ── Archon server ─────────────────────────────────────────────────

    private static ServiceState probeArchon(String base) {
        ServiceState s = new ServiceState();
        s.key = 'archon';
        s.name = 'Archon server';
        s.url = base;
        Long started = System.currentTimeMillis();
        try {
            HttpRequest req = new HttpRequest();
            req.setEndpoint(base + '/health');
            req.setMethod('GET');
            req.setTimeout(HEALTH_TIMEOUT_MS);
            HttpResponse res = new Http().send(req);
            s.ms = elapsed(started);
            if (isWakingResponse(res)) {
                s.status = 'waking';
                s.message = 'Host answered ' + res.getStatusCode() + ' — still starting.';
                return s;
            }
            if (res.getStatusCode() >= 400) {
                s.status = 'unreachable';
                s.message = 'Health check returned ' + res.getStatusCode() + '.';
                return s;
            }
            s.status = 'online';
            s.message = describeBuild(res.getBody());
        } catch (Exception e) {
            s.ms = elapsed(started);
            String msg = e.getMessage() == null ? '' : e.getMessage();
            // A read timeout mid-spin-up is the wake-up case; DNS/TLS/Remote
            // Site failures are not and would never heal by polling.
            if (msg.containsIgnoreCase('timed out') || msg.containsIgnoreCase('timeout')) {
                s.status = 'waking';
                s.message = 'No answer within ' + (HEALTH_TIMEOUT_MS / 1000) + 's — still starting.';
            } else {
                s.status = 'unreachable';
                s.message = msg.length() > 200 ? msg.left(200) + '…' : msg;
            }
        }
        return s;
    }

    /** "build 1a2b3c4d, up 42s" from the /health JSON; null when it isn't the JSON we know. */
    private static String describeBuild(String body) {
        if (String.isBlank(body)) return null;
        try {
            Map<String, Object> j = (Map<String, Object>) JSON.deserializeUntyped(body);
            List<String> bits = new List<String>();
            if (j.get('commit') != null && j.get('commit') != 'unknown') bits.add('build ' + j.get('commit'));
            if (j.get('uptime') != null) bits.add('up ' + formatUptime(((Decimal) j.get('uptime')).intValue()));
            return bits.isEmpty() ? null : String.join(bits, ', ');
        } catch (Exception e) {
            return null;
        }
    }

    private static String formatUptime(Integer seconds) {
        if (seconds < 60) return seconds + 's';
        if (seconds < 3600) return (seconds / 60) + 'm';
        return (seconds / 3600) + 'h ' + (Math.mod(seconds, 3600) / 60) + 'm';
    }

    // ── MCP servers ───────────────────────────────────────────────────

    /** Every MCP host the org's agents can touch: packaged catalog + custom servers. */
    private static List<ServiceState> collectTargets() {
        List<ServiceState> out = new List<ServiceState>();
        Set<String> seen = new Set<String>();
        for (ConnectorCatalog__mdt cat : [
            SELECT DeveloperName, DisplayName__c, McpServerUrl__c
            FROM ConnectorCatalog__mdt
            WHERE McpServerUrl__c != null
            ORDER BY SortOrder__c ASC NULLS LAST, DisplayName__c ASC
        ]) {
            addTarget(out, seen, cat.DeveloperName,
                String.isBlank(cat.DisplayName__c) ? cat.DeveloperName : cat.DisplayName__c,
                cat.McpServerUrl__c);
        }
        for (CustomMcpServer__c c : [
            SELECT Id, Name, McpServerUrl__c
            FROM CustomMcpServer__c
            WHERE IsActive__c = true AND McpServerUrl__c != null
            WITH USER_MODE
            ORDER BY Name ASC
        ]) {
            addTarget(out, seen, 'custom_' + c.Id, c.Name, c.McpServerUrl__c);
        }
        return out;
    }

    private static void addTarget(List<ServiceState> out, Set<String> seen, String key, String name, String url) {
        String origin = url.trim().removeEnd('/');
        if (String.isBlank(origin) || seen.contains(origin)) return;
        seen.add(origin);
        ServiceState s = new ServiceState();
        s.key = key;
        s.name = name;
        s.url = origin;
        s.status = 'pending';
        out.add(s);
    }

    private static void fanOut(List<ServiceState> targets) {
        List<Map<String, Object>> body = new List<Map<String, Object>>();
        for (ServiceState t : targets) {
            body.add(new Map<String, Object>{ 'key' => t.key, 'name' => t.name, 'url' => t.url });
        }
        HttpResponse res;
        try {
            res = ArchonServerClient.callout('POST', '/api/connectors/wake',
                JSON.serialize(new Map<String, Object>{ 'targets' => body }), FANOUT_TIMEOUT_MS);
        } catch (Exception e) {
            markAll(targets, 'waking', 'Probe did not finish in time — polling again.');
            return;
        }
        if (res.getStatusCode() == 404) {
            // Express answers an unknown route with an HTML 404 — that is an
            // old server build, not a cold start, and polling won't fix it.
            markAll(targets, 'unreachable', 'The Archon server build that is live does not have the wake probe yet — deploy the latest server.');
            return;
        }
        if (isWakingResponse(res)) {
            markAll(targets, 'waking', 'The Archon server is still starting.');
            return;
        }
        if (res.getStatusCode() >= 400) {
            markAll(targets, 'unreachable', 'Probe failed: ' + ArchonServerClient.extractServerError(res));
            return;
        }
        Map<String, ServiceState> byKey = new Map<String, ServiceState>();
        for (ServiceState t : targets) byKey.put(t.key, t);
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        Object rows = parsed.get('targets');
        if (!(rows instanceof List<Object>)) return;
        for (Object item : (List<Object>) rows) {
            Map<String, Object> r = (Map<String, Object>) item;
            ServiceState t = byKey.get((String) r.get('key'));
            if (t == null) continue;
            t.status = (String) r.get('status');
            t.ms = r.get('ms') == null ? null : ((Decimal) r.get('ms')).intValue();
            t.message = (String) r.get('message');
        }
    }

    // ── helpers ───────────────────────────────────────────────────────

    private static void markAll(List<ServiceState> targets, String status, String message) {
        for (ServiceState t : targets) {
            t.status = status;
            t.message = message;
        }
    }

    /** Render's edge answers 502/503 or an HTML "Application loading" page while a service spins up. */
    private static Boolean isWakingResponse(HttpResponse res) {
        String body = res.getBody();
        Boolean htmlBody = body != null && body.trim().startsWith('<');
        return htmlBody || res.getStatusCode() == 502 || res.getStatusCode() == 503;
    }

    private static Integer elapsed(Long started) {
        return (Integer) (System.currentTimeMillis() - started);
    }

    private static String getServerUrl() {
        List<SynapseConfig__mdt> rows = [
            SELECT ServerUrl__c FROM SynapseConfig__mdt WHERE DeveloperName = 'Default' LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0].ServerUrl__c;
    }
}
