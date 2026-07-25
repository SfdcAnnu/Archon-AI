/**
 * ThirdPartyLeadEnrichmentAction — scaffold for a client's own third-party
 * integration, exposed as a real Invocable Action so it can be called
 * deterministically from a "Call a Tool (Connector)" node (pick this class
 * under Tool type = Custom, once deployed), with its result named via that
 * node's "Output variable name" field and referenced downstream as
 * {!thatName.result.someField} in an AI node's instruction.
 *
 * This is a working skeleton, not a fake stub — it makes a real HTTP
 * callout and handles success/failure — but the endpoint/parsing is
 * placeholder and MUST be replaced with the client's real API before use:
 *
 *   1. Setup -> Named Credentials -> create one pointing at the real API
 *      (handles auth so no key ever needs to live in this class).
 *   2. Replace the endpoint below with
 *      'callout:<YourNamedCredentialName>/<real path>'.
 *   3. Replace the response-parsing block with whatever shape the real
 *      API actually returns.
 *
 * Until step 1 is done, calling this will fail cleanly (caught below,
 * returned as success=false) rather than breaking the whole agent run.
 */
public with sharing class ThirdPartyLeadEnrichmentAction {

    @InvocableMethod(
        label='Enrich Lead From Third-Party API'
        description='Calls a client-owned third-party API to fetch additional company/lead data not stored in Salesforce, for use as AI prompt context.'
        category='Archon AI Integrations'
    )
    public static List<Output> enrich(List<Input> inputs) {
        List<Output> results = new List<Output>();
        for (Input inp : inputs) {
            results.add(enrichOne(inp));
        }
        return results;
    }

    private static Output enrichOne(Input inp) {
        Output out = new Output();
        try {
            // ── REPLACE this whole try block with the real integration ──
            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:ThirdPartyLeadEnrichment/v1/lookup?leadId=' + EncodingUtil.urlEncode(inp.leadId, 'UTF-8'));
            req.setMethod('GET');
            req.setTimeout(15000);
            HttpResponse res = new Http().send(req);

            if (res.getStatusCode() >= 200 && res.getStatusCode() < 300) {
                out.success = true;
                out.rawResponse = res.getBody();
                Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
                out.enrichmentSummary   = parsed.get('summary')    != null ? String.valueOf(parsed.get('summary'))    : null;
                out.companySizeEstimate = parsed.get('companySize')!= null ? String.valueOf(parsed.get('companySize')): null;
                out.confidenceScore     = parsed.get('confidence') != null ? String.valueOf(parsed.get('confidence')) : null;
            } else {
                out.success = false;
                out.rawResponse = 'HTTP ' + res.getStatusCode() + ': ' + res.getBody();
            }
            // ── END REPLACE block ──

        } catch (Exception e) {
            out.success = false;
            out.rawResponse = 'Enrichment call failed (expected until the Named Credential above is configured): ' + e.getMessage();
        }
        return out;
    }

    public class Input {
        @InvocableVariable(label='Lead Id' required=true)
        public String leadId;
    }

    public class Output {
        @InvocableVariable(label='Success')
        public Boolean success;
        @InvocableVariable(label='Enrichment Summary')
        public String enrichmentSummary;
        @InvocableVariable(label='Estimated Company Size')
        public String companySizeEstimate;
        @InvocableVariable(label='Confidence Score')
        public String confidenceScore;
        @InvocableVariable(label='Raw Response (debug)')
        public String rawResponse;
    }
}
