/**
 * Schema describes for the React builder's Prebuilt Salesforce actions:
 * object list and per-object field metadata (types, required flags,
 * picklist values) so the Tool form offers real pickers instead of typed
 * API names. Read-only; native Apex describes, no server round-trip.
 */
@RestResource(urlMapping='/agent-builder/schema/*')
global with sharing class AgentSchemaRestService {

    @HttpGet
    global static void doGet() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            String action = req.params.get('action');
            if (action == 'objects') {
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(listObjects()));
            } else if (action == 'fields') {
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(listFields(req.params.get('object'))));
            } else {
                res.statusCode = 400;
                res.responseBody = Blob.valueOf('{"error":"Unknown action — use ?action=objects or ?action=fields&object=X"}');
            }
        } catch (Exception e) {
            res.statusCode = 400;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => e.getMessage() }));
        }
    }

    private static List<Map<String, Object>> listObjects() {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        Map<String, Schema.SObjectType> gd = Schema.getGlobalDescribe();
        for (String key : gd.keySet()) {
            // Describe loops are CPU-heavy on big orgs — stop early with a
            // best-effort list rather than blowing the transaction.
            if (Limits.getCpuTime() > 8000) break;
            Schema.DescribeSObjectResult d = gd.get(key).getDescribe();
            if (!d.isAccessible() || !d.isQueryable() || d.isCustomSetting() || d.isDeprecatedAndHidden()) continue;
            if (!d.isCreateable() && !d.isUpdateable() && !d.isSearchable()) continue;
            out.add(new Map<String, Object>{
                'name' => d.getName(),
                'label' => d.getLabel(),
                'custom' => d.isCustom()
            });
        }
        return out;
    }

    private static List<Map<String, Object>> listFields(String objectName) {
        if (String.isBlank(objectName) || !Pattern.matches('^[A-Za-z][A-Za-z0-9_]{0,80}$', objectName)) {
            throw new SchemaException('Invalid object name.');
        }
        Map<String, Schema.SObjectType> gd = Schema.getGlobalDescribe();
        Schema.SObjectType t = gd.get(objectName.toLowerCase());
        if (t == null) throw new SchemaException('Object not found: ' + objectName);
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Schema.SObjectField f : t.getDescribe().fields.getMap().values()) {
            Schema.DescribeFieldResult d = f.getDescribe();
            if (!d.isAccessible()) continue;
            if (!d.isCreateable() && !d.isUpdateable() && !d.isFilterable()) continue;
            List<String> picks = new List<String>();
            for (Schema.PicklistEntry p : d.getPicklistValues()) {
                if (p.isActive() && picks.size() < 15) picks.add(p.getValue());
            }
            List<String> refs = new List<String>();
            for (Schema.SObjectType r : d.getReferenceTo()) {
                refs.add(String.valueOf(r));
                if (refs.size() >= 3) break;
            }
            out.add(new Map<String, Object>{
                'name' => d.getName(),
                'label' => d.getLabel(),
                'type' => String.valueOf(d.getType()).toLowerCase(),
                'required' => !d.isNillable() && d.isCreateable() && !d.isDefaultedOnCreate(),
                'createable' => d.isCreateable(),
                'updateable' => d.isUpdateable(),
                'picklistValues' => picks,
                'referenceTo' => refs
            });
        }
        return out;
    }

    global class SchemaException extends Exception {}
}
