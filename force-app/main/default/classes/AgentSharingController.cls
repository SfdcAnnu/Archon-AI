/**
 * Archon AI — agent sharing, driven from the builder's Share panel.
 *
 * AgentDefinition__c has OWD Private; chat users only see agents that have
 * an explicit share row. This controller manages those rows via the custom
 * Apex sharing reason (ArchonAccess__c) so shares survive owner changes and
 * are clearly labeled in the record's Sharing Detail.
 *
 * Only users with FULL access to the agent (owner, hierarchy above the
 * owner, or Modify All Data) can view or change its shares.
 */
public with sharing class AgentSharingController {

    public class ShareTarget {
        @AuraEnabled public String id;
        @AuraEnabled public String name;
        @AuraEnabled public String targetType;   // User | Group | Role | RoleAndSubordinates
    }

    public class ShareRow {
        @AuraEnabled public String shareId;
        @AuraEnabled public String userOrGroupId;
        @AuraEnabled public String name;
        @AuraEnabled public String targetType;
    }

    // ── READ ─────────────────────────────────────────────────────────

    @AuraEnabled
    public static List<ShareRow> getShares(Id agentId) {
        assertFullAccess(agentId);

        List<AgentDefinition__Share> shares = [
            SELECT Id, UserOrGroupId
            FROM AgentDefinition__Share
            WHERE ParentId = :agentId
              AND RowCause = :Schema.AgentDefinition__Share.RowCause.ArchonAccess__c
            ORDER BY Id
        ];
        if (shares.isEmpty()) return new List<ShareRow>();

        Set<Id> targetIds = new Set<Id>();
        for (AgentDefinition__Share s : shares) targetIds.add(s.UserOrGroupId);

        Map<Id, User> users = new Map<Id, User>([
            SELECT Id, Name FROM User WHERE Id IN :targetIds
        ]);
        Map<Id, Group> groups = new Map<Id, Group>([
            SELECT Id, Name, Type, RelatedId FROM Group WHERE Id IN :targetIds
        ]);

        // Role groups carry the role id — resolve friendly role names.
        Set<Id> roleIds = new Set<Id>();
        for (Group g : groups.values()) {
            if (g.RelatedId != null) roleIds.add(g.RelatedId);
        }
        Map<Id, UserRole> roles = roleIds.isEmpty()
            ? new Map<Id, UserRole>()
            : new Map<Id, UserRole>([SELECT Id, Name FROM UserRole WHERE Id IN :roleIds]);

        List<ShareRow> out = new List<ShareRow>();
        for (AgentDefinition__Share s : shares) {
            ShareRow r = new ShareRow();
            r.shareId = s.Id;
            r.userOrGroupId = s.UserOrGroupId;
            if (users.containsKey(s.UserOrGroupId)) {
                r.name = users.get(s.UserOrGroupId).Name;
                r.targetType = 'User';
            } else if (groups.containsKey(s.UserOrGroupId)) {
                Group g = groups.get(s.UserOrGroupId);
                if (g.Type == 'Role' || g.Type == 'RoleAndSubordinates') {
                    UserRole ur = roles.get(g.RelatedId);
                    r.name = (ur != null ? ur.Name : g.Name);
                    r.targetType = g.Type;
                } else {
                    r.name = g.Name;
                    r.targetType = 'Group';
                }
            } else {
                r.name = String.valueOf(s.UserOrGroupId);
                r.targetType = 'Unknown';
            }
            out.add(r);
        }
        return out;
    }

    // ── SEARCH users / public groups / roles ─────────────────────────

    @AuraEnabled
    public static List<ShareTarget> searchTargets(String term) {
        String pat = '%' + (term == null ? '' : String.escapeSingleQuotes(term.trim())) + '%';
        List<ShareTarget> out = new List<ShareTarget>();

        for (User u : [
            SELECT Id, Name FROM User
            WHERE IsActive = true AND UserType = 'Standard' AND Name LIKE :pat
            ORDER BY Name LIMIT 8
        ]) {
            ShareTarget t = new ShareTarget();
            t.id = u.Id; t.name = u.Name; t.targetType = 'User';
            out.add(t);
        }

        for (Group g : [
            SELECT Id, Name FROM Group
            WHERE Type = 'Regular' AND Name LIKE :pat
            ORDER BY Name LIMIT 8
        ]) {
            ShareTarget t = new ShareTarget();
            t.id = g.Id; t.name = g.Name; t.targetType = 'Group';
            out.add(t);
        }

        List<UserRole> matchedRoles = [
            SELECT Id, Name FROM UserRole WHERE Name LIKE :pat ORDER BY Name LIMIT 8
        ];
        if (!matchedRoles.isEmpty()) {
            Map<Id, UserRole> roleById = new Map<Id, UserRole>(matchedRoles);
            for (Group g : [
                SELECT Id, Type, RelatedId FROM Group
                WHERE Type IN ('Role', 'RoleAndSubordinates') AND RelatedId IN :roleById.keySet()
                ORDER BY Type
            ]) {
                ShareTarget t = new ShareTarget();
                t.id = g.Id;
                t.name = roleById.get(g.RelatedId).Name;
                t.targetType = g.Type;
                out.add(t);
            }
        }
        return out;
    }

    // ── WRITE ────────────────────────────────────────────────────────

    @AuraEnabled
    public static List<ShareRow> addShare(Id agentId, Id userOrGroupId) {
        assertFullAccess(agentId);

        // Idempotent — skip if this target is already shared by us.
        List<AgentDefinition__Share> existing = [
            SELECT Id FROM AgentDefinition__Share
            WHERE ParentId = :agentId
              AND UserOrGroupId = :userOrGroupId
              AND RowCause = :Schema.AgentDefinition__Share.RowCause.ArchonAccess__c
            LIMIT 1
        ];
        if (existing.isEmpty()) {
            insert new AgentDefinition__Share(
                ParentId      = agentId,
                UserOrGroupId = userOrGroupId,
                AccessLevel   = 'Read',
                RowCause      = Schema.AgentDefinition__Share.RowCause.ArchonAccess__c
            );
        }
        return getShares(agentId);
    }

    @AuraEnabled
    public static List<ShareRow> removeShare(Id agentId, Id shareId) {
        assertFullAccess(agentId);
        List<AgentDefinition__Share> rows = [
            SELECT Id FROM AgentDefinition__Share
            WHERE Id = :shareId
              AND ParentId = :agentId
              AND RowCause = :Schema.AgentDefinition__Share.RowCause.ArchonAccess__c
            LIMIT 1
        ];
        if (!rows.isEmpty()) delete rows;
        return getShares(agentId);
    }

    // ── GUARD ────────────────────────────────────────────────────────

    private static void assertFullAccess(Id agentId) {
        List<UserRecordAccess> access = [
            SELECT RecordId, HasAllAccess
            FROM UserRecordAccess
            WHERE UserId = :UserInfo.getUserId() AND RecordId = :agentId
            LIMIT 1
        ];
        if (access.isEmpty() || !access[0].HasAllAccess) {
            throw new AuraHandledException('Only the agent\'s owner or an admin with full access can manage sharing.');
        }
    }
}
