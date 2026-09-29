/**
 * Archon AI — ADMIN side of connector identity.
 *
 * Whose account a connector runs as: the org's shared connection, a
 * department's (a group connection bound to a Permission Set, Public
 * Group or Department value), or each person's own. This class carries the
 * admin operations: the org-wide policy, one provider's connections, the
 * roster of people who must connect, the groups to bind to, an admin's
 * override of a connector's MCP server, and reminders.
 *
 * Most answers are the Archon server's JSON passed through as a String —
 * the React page reads the same shape the server documents, and Apex adds
 * nothing but the org's session. The roster is the one thing composed
 * here, because who MUST connect is a Salesforce question: the agents a
 * person has used and the users behind them.
 */
public with sharing class AgentIdentityController {

    // ── policy ────────────────────────────────────────────────────────

    @AuraEnabled
    public static String getPolicy() {
        return passThrough(ArchonServerClient.callout('GET', '/api/connectors/policy', null), 'Could not read the identity policy');
    }

    @AuraEnabled
    public static String savePolicy(String policyJson) {
        if (String.isBlank(policyJson)) throw failure('policyJson is required.');
        return passThrough(ArchonServerClient.callout('PUT', '/api/connectors/policy', policyJson), 'Could not save the identity policy');
    }

    // ── one provider ──────────────────────────────────────────────────

    /** Per provider, who has connected: { providers: { key: { org, groups, users: {connected, expired, total} } } } */
    @AuraEnabled
    public static String getSummary() {
        return passThrough(ArchonServerClient.callout('GET', '/api/connectors/identity-summary', null), 'Could not read connection summary');
    }

    @AuraEnabled
    public static String getDetail(String providerKey) {
        requireProvider(providerKey);
        String raw = passThrough(ArchonServerClient.callout('GET', '/api/connectors/detail?providerKey=' + EncodingUtil.urlEncode(providerKey, 'UTF-8'), null), 'Could not read the connector');
        // The server knows who connected a row only as a user Id; the page
        // wants a name.
        try {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(raw);
            List<Map<String, Object>> rows = new List<Map<String, Object>>();
            if (body.get('org') instanceof Map<String, Object>) rows.add((Map<String, Object>) body.get('org'));
            if (body.get('groups') instanceof List<Object>) for (Object g : (List<Object>) body.get('groups')) rows.add((Map<String, Object>) g);
            Set<Id> ids = new Set<Id>();
            for (Map<String, Object> r : rows) {
                try { if (r.get('configuredBy') instanceof String) ids.add((Id) r.get('configuredBy')); } catch (Exception e) { /* not an Id */ }
            }
            if (ids.isEmpty()) return raw;
            Map<Id, User> people = new Map<Id, User>([SELECT Id, Name FROM User WHERE Id IN :ids]);
            for (Map<String, Object> r : rows) {
                try {
                    Id uid = (Id) r.get('configuredBy');
                    if (people.containsKey(uid)) r.put('configuredByName', people.get(uid).Name);
                } catch (Exception e) { /* not an Id */ }
            }
            return JSON.serialize(body);
        } catch (Exception e) {
            return raw;
        }
    }

    @AuraEnabled
    public static String listGroups(String groupType) {
        if (String.isBlank(groupType)) throw failure('groupType is required.');
        return passThrough(ArchonServerClient.callout('GET', '/api/connectors/groups?type=' + EncodingUtil.urlEncode(groupType, 'UTF-8'), null), 'Could not list groups');
    }

    /** The OAuth authorize URL for a connection owned by the ORG or by a GROUP. */
    @AuraEnabled
    public static String startPrincipalOAuth(String providerKey, String displayName, String returnUrl, String principalType, String subjectType, String subjectKey, String subjectLabel) {
        requireProvider(providerKey);
        Map<String, Object> body = new Map<String, Object>{
            'providerKey'   => providerKey,
            'displayName'   => String.isBlank(displayName) ? providerKey : displayName,
            'returnUrl'     => returnUrl,
            'userId'        => UserInfo.getUserId(),
            'principalType' => String.isBlank(principalType) ? 'org' : principalType,
            'subjectType'   => subjectType,
            'subjectKey'    => subjectKey,
            'subjectLabel'  => subjectLabel
        };
        return passThrough(ArchonServerClient.callout('POST', '/api/connectors/oauth/start', JSON.serialize(body)), 'Could not start the connection');
    }

    // ── the MCP server behind a connector ─────────────────────────────

    @AuraEnabled
    public static String getServerOverride(String providerKey) {
        requireProvider(providerKey);
        return passThrough(ArchonServerClient.callout('GET', '/api/connectors/server?providerKey=' + EncodingUtil.urlEncode(providerKey, 'UTF-8'), null), 'Could not read the server override');
    }

    @AuraEnabled
    public static String saveServerOverride(String providerKey, String mcpServerUrl, String authStyle, String apiKey) {
        requireProvider(providerKey);
        if (String.isBlank(mcpServerUrl)) throw failure('mcpServerUrl is required.');
        Map<String, Object> body = new Map<String, Object>{
            'providerKey' => providerKey, 'mcpServerUrl' => mcpServerUrl,
            'authStyle' => String.isBlank(authStyle) ? 'provider-token' : authStyle,
            'userId' => UserInfo.getUserId()
        };
        if (apiKey != null) body.put('apiKey', apiKey);
        return passThrough(ArchonServerClient.callout('PUT', '/api/connectors/server', JSON.serialize(body)), 'Could not save the server override');
    }

    @AuraEnabled
    public static String deleteServerOverride(String providerKey) {
        requireProvider(providerKey);
        return passThrough(ArchonServerClient.callout('DELETE', '/api/connectors/server?providerKey=' + EncodingUtil.urlEncode(providerKey, 'UTF-8'), null), 'Could not remove the server override');
    }

    @AuraEnabled
    public static String testServer(String providerKey, String mcpServerUrl, String authStyle, String apiKey) {
        requireProvider(providerKey);
        if (String.isBlank(mcpServerUrl)) throw failure('mcpServerUrl is required.');
        Map<String, Object> body = new Map<String, Object>{
            'providerKey' => providerKey, 'mcpServerUrl' => mcpServerUrl, 'authStyle' => authStyle, 'apiKey' => apiKey, 'userId' => UserInfo.getUserId()
        };
        HttpResponse res = ArchonServerClient.callout('POST', '/api/connectors/server/test', JSON.serialize(body), 90000);
        // A failed test is an answer, not an exception: the page shows it.
        return res.getBody();
    }

    // ── the roster: who must connect, who did ─────────────────────────

    public class RosterUser {
        @AuraEnabled public String userId;
        @AuraEnabled public String name;
        @AuraEnabled public String email;
        @AuraEnabled public String status;          // connected | pending | error | expired | notConnected | viaGroup
        @AuraEnabled public String accountEmail;
        @AuraEnabled public String lastConnectedAt;
        @AuraEnabled public String lastErrorMessage;
        @AuraEnabled public List<String> neededBy = new List<String>();
        @AuraEnabled public Integer remindedCount = 0;
        @AuraEnabled public String remindedAt;
        @AuraEnabled public String connectionId;
    }

    public class Roster {
        @AuraEnabled public String providerKey;
        @AuraEnabled public List<RosterUser> users = new List<RosterUser>();
        @AuraEnabled public Integer mustConnect = 0;
        @AuraEnabled public Integer connected = 0;
        @AuraEnabled public Integer notConnected = 0;
        @AuraEnabled public Integer expired = 0;
        @AuraEnabled public List<String> agentsNeeding = new List<String>();
        @AuraEnabled public Boolean serverUnreachable = false;
    }

    /**
     * Who must connect their own account for this provider — everyone who
     * has used an agent whose connector runs as the person and is required —
     * merged with the server's user connections and reminders.
     */
    @AuraEnabled
    public static Roster getRoster(String providerKey) {
        requireProvider(providerKey);
        Roster out = new Roster();
        out.providerKey = providerKey;

        // 1. Agents whose node for this provider runs as the person.
        Map<Id, String> agentNames = new Map<Id, String>();
        for (AgentNode__c n : [
            SELECT AgentDefinition__c, AgentDefinition__r.Name, ConfigJson__c FROM AgentNode__c
            WHERE NodeType__c = 'catalog' AND IsEnabled__c = true AND AgentDefinition__r.Status__c = 'Active'
            WITH USER_MODE LIMIT 2000
        ]) {
            if (String.isBlank(n.ConfigJson__c)) continue;
            try {
                Map<String, Object> cfg = (Map<String, Object>) JSON.deserializeUntyped(n.ConfigJson__c);
                if ((String) cfg.get('provider') != providerKey) continue;
                String runAs = (String) cfg.get('runAs');
                if (runAs != 'user' && runAs != 'group') continue;
                agentNames.put(n.AgentDefinition__c, n.AgentDefinition__r.Name);
            } catch (Exception e) { /* unreadable node */ }
        }
        // Salesforce's own PerUser mode counts too.
        if (providerKey == 'salesforce_mcp') {
            for (AgentDefinition__c a : [SELECT Id, Name FROM AgentDefinition__c WHERE AccessMode__c = 'PerUser' AND Status__c = 'Active' WITH USER_MODE LIMIT 500]) {
                agentNames.put(a.Id, a.Name);
            }
        }
        out.agentsNeeding = agentNames.values();

        // 2. The people who used those agents (chats and runs, last 90 days).
        Map<Id, RosterUser> byUser = new Map<Id, RosterUser>();
        if (!agentNames.isEmpty()) {
            Set<Id> agentIds = agentNames.keySet();
            for (ChatSession__c s : [
                SELECT User__c, AgentDefinition__c FROM ChatSession__c
                WHERE AgentDefinition__c IN :agentIds AND LastActivityAt__c = LAST_N_DAYS:90 AND User__c != null
                WITH USER_MODE LIMIT 5000
            ]) {
                noteNeed(byUser, s.User__c, agentNames.get(s.AgentDefinition__c));
            }
            for (AgentExecution__c e : [
                SELECT CreatedById, AgentDefinition__c FROM AgentExecution__c
                WHERE AgentDefinition__c IN :agentIds AND CreatedDate = LAST_N_DAYS:90
                WITH USER_MODE LIMIT 5000
            ]) {
                noteNeed(byUser, e.CreatedById, agentNames.get(e.AgentDefinition__c));
            }
        }

        // 3. The server's rows and reminders for this provider.
        HttpResponse res = ArchonServerClient.callout('GET', '/api/connectors/principals?providerKey=' + EncodingUtil.urlEncode(providerKey, 'UTF-8'), null);
        String raw = res.getBody();
        if (res.getStatusCode() >= 400 || (raw != null && raw.trim().startsWith('<'))) {
            out.serverUnreachable = true;
        } else {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(raw);
            Long now = System.now().getTime();
            for (Object o : (List<Object>) body.get('connections')) {
                Map<String, Object> c = (Map<String, Object>) o;
                if ((String) c.get('principalType') != 'user') continue;
                String uid = (String) c.get('subjectKey');
                if (String.isBlank(uid)) continue;
                RosterUser u = ensureUser(byUser, uid);
                String status = (String) c.get('status');
                String expires = (String) c.get('tokenExpiresAt');
                Boolean hasRefresh = c.get('hasRefreshToken') == true;
                if (status == 'Connected' && expires != null && !hasRefresh && expiredIso(expires, now)) u.status = 'expired';
                else if (status == 'Connected') u.status = 'connected';
                else if (status == 'Pending') u.status = 'pending';
                else if (status == 'Error') u.status = 'error';
                else u.status = 'notConnected';
                u.accountEmail = (String) c.get('accountEmail');
                u.lastConnectedAt = (String) c.get('lastConnectedAt');
                u.lastErrorMessage = (String) c.get('lastErrorMessage');
                u.connectionId = (String) c.get('id');
            }
            // Someone an admin invited belongs on the roster before they
            // connect, and before they have used an agent.
            for (Object o : (List<Object>) body.get('reminders')) {
                Map<String, Object> r = (Map<String, Object>) o;
                String uid = (String) r.get('userId');
                if (String.isBlank(uid)) continue;
                RosterUser u = ensureUser(byUser, uid);
                u.remindedCount = r.get('count') == null ? 0 : Integer.valueOf(r.get('count'));
                u.remindedAt = (String) r.get('lastSentAt');
            }
        }

        // 4. Names and emails.
        for (User usr : [SELECT Id, Name, Email FROM User WHERE Id IN :byUser.keySet()]) {
            RosterUser u = byUser.get(usr.Id);
            u.name = usr.Name;
            u.email = usr.Email;
        }
        for (RosterUser u : byUser.values()) {
            if (u.status == null) u.status = 'notConnected';
            if (!u.neededBy.isEmpty()) out.mustConnect++;
            if (u.status == 'connected') out.connected++;
            else if (u.status == 'expired') out.expired++;
            else if (!u.neededBy.isEmpty()) out.notConnected++;
            out.users.add(u);
        }
        return out;
    }

    private static void noteNeed(Map<Id, RosterUser> byUser, Id userId, String agentName) {
        if (userId == null) return;
        RosterUser u = ensureUser(byUser, userId);
        if (agentName != null && !u.neededBy.contains(agentName)) u.neededBy.add(agentName);
    }

    private static RosterUser ensureUser(Map<Id, RosterUser> byUser, String userId) {
        Id uid;
        try { uid = (Id) userId; } catch (Exception e) { return new RosterUser(); }
        if (!byUser.containsKey(uid)) {
            RosterUser u = new RosterUser();
            u.userId = uid;
            byUser.put(uid, u);
        }
        return byUser.get(uid);
    }

    private static Boolean expiredIso(String iso, Long now) {
        try { return JSON.deserialize('"' + iso + '"', Datetime.class) != null && ((Datetime) JSON.deserialize('"' + iso + '"', Datetime.class)).getTime() < now; }
        catch (Exception e) { return false; }
    }

    // ── people an admin adds by hand ──────────────────────────────────

    /** Active people matching a name or email, for the add-user dialog. */
    @AuraEnabled
    public static String searchUsers(String q) {
        String pattern = '%' + String.escapeSingleQuotes(q == null ? '' : q.trim()) + '%';
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (User u : [
            SELECT Id, Name, Email, Department, Title FROM User
            WHERE IsActive = true AND UserType = 'Standard' AND (Name LIKE :pattern OR Email LIKE :pattern)
            ORDER BY Name LIMIT 25
        ]) {
            out.add(new Map<String, Object>{ 'userId' => u.Id, 'name' => u.Name, 'email' => u.Email, 'department' => u.Department, 'title' => u.Title });
        }
        return JSON.serialize(new Map<String, Object>{ 'users' => out });
    }

    // ── reminders ─────────────────────────────────────────────────────

    /** Email + Salesforce notification to each person, recorded on the server. */
    @AuraEnabled
    public static Integer sendReminders(String providerKey, List<String> userIds, String agentApiName) {
        requireProvider(providerKey);
        if (userIds == null || userIds.isEmpty()) throw failure('Pick at least one person.');
        List<Id> ids = new List<Id>();
        for (String s : userIds) { try { ids.add((Id) s); } catch (Exception e) { /* skip */ } }
        return ConnectionReminderService.send(providerKey, ids, agentApiName);
    }

    // ── plumbing ──────────────────────────────────────────────────────

    public class IdentityException extends Exception {}

    /** Apex REST cannot throw AuraHandledException (it surfaces as an
     *  uncatchable LimitException); an Aura caller wants exactly that. */
    private static Exception failure(String message) {
        return RestContext.request != null ? (Exception) new IdentityException(message) : (Exception) new AuraHandledException(message);
    }

    private static void requireProvider(String providerKey) {
        if (String.isBlank(providerKey)) throw failure('providerKey is required.');
    }

    private static String passThrough(HttpResponse res, String what) {
        String raw = res.getBody();
        Boolean htmlBody = raw != null && raw.trim().startsWith('<');
        if (htmlBody || res.getStatusCode() == 502 || res.getStatusCode() == 503) {
            throw failure('SERVER_WAKING: The Archon server is waking up from idle — this usually takes under a minute. Try again shortly.');
        }
        if (res.getStatusCode() >= 400) {
            throw failure(what + ': ' + ArchonServerClient.extractServerError(res));
        }
        return raw;
    }
}
