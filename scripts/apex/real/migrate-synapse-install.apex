// One-time copy after the Synapse -> Archon rename: the org-default install
// row (the server session key) moves from SynapseInstall__c to ArchonInstall__c.
// Safe to re-run: it only fills ArchonInstall__c when it has no key yet.
SynapseInstall__c oldRow = SynapseInstall__c.getOrgDefaults();
ArchonInstall__c newRow = ArchonInstall__c.getOrgDefaults();
if (String.isBlank(oldRow.SessionKey__c)) {
    System.debug('MIGRATE: old row has no session key; nothing to copy');
} else if (!String.isBlank(newRow.SessionKey__c)) {
    System.debug('MIGRATE: ArchonInstall__c already has a key; left alone. same=' + (newRow.SessionKey__c == oldRow.SessionKey__c));
} else {
    newRow.SetupOwnerId = UserInfo.getOrganizationId();
    newRow.SessionKey__c = oldRow.SessionKey__c;
    newRow.ConfiguredAt__c = oldRow.ConfiguredAt__c;
    newRow.ConfiguredByEmail__c = oldRow.ConfiguredByEmail__c;
    upsert newRow;
    System.debug('MIGRATE: copied session key (length ' + newRow.SessionKey__c.length() + ') configured ' + newRow.ConfiguredAt__c);
}
ArchonConfig__mdt cfg = ArchonConfig__mdt.getInstance('Default');
System.debug('MIGRATE: ArchonConfig server=' + (cfg == null ? 'MISSING' : cfg.ServerUrl__c) + ' secretSet=' + (cfg != null && !String.isBlank(cfg.JwtSecret__c)));
