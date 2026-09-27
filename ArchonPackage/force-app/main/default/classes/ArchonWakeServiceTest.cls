@IsTest
private class ArchonWakeServiceTest {

    /** Routes by path: /health vs /api/connectors/wake, so one mock covers both hops. */
    private class RoutedMock implements HttpCalloutMock {
        Integer healthCode; String healthBody;
        Integer wakeCode;   String wakeBody;
        Boolean throwOnWake = false;
        Integer wakeCalls = 0;
        String lastWakeBody;
        RoutedMock(Integer healthCode, String healthBody, Integer wakeCode, String wakeBody) {
            this.healthCode = healthCode; this.healthBody = healthBody;
            this.wakeCode = wakeCode;     this.wakeBody = wakeBody;
        }
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            if (req.getEndpoint().endsWith('/health')) {
                res.setStatusCode(healthCode);
                res.setBody(healthBody);
            } else {
                wakeCalls++;
                lastWakeBody = req.getBody();
                if (throwOnWake) throw new CalloutException('Read timed out');
                res.setStatusCode(wakeCode);
                res.setBody(wakeBody);
            }
            return res;
        }
    }

    private static void seedSession() {
        insert new SynapseInstall__c(
            SetupOwnerId = UserInfo.getOrganizationId(),
            SessionKey__c = 'sk-test',
            ConfiguredAt__c = System.now()
        );
    }

    private static CustomMcpServer__c seedCustomServer(String url) {
        CustomMcpServer__c c = new CustomMcpServer__c(
            Name = 'Custom MCP', McpServerUrl__c = url, IsActive__c = true,
            CatalogType__c = 'custom', Category__c = 'Custom'
        );
        insert c;
        return c;
    }

    @IsTest
    static void archon_waking_leaves_targets_pending_and_skips_fanout() {
        seedSession();
        seedCustomServer('https://custom.example.com/');
        RoutedMock mock = new RoutedMock(503, '<!doctype html><html>Application loading</html>', 200, '{}');
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        ArchonWakeService.WakeResult r = ArchonWakeService.wake();
        Test.stopTest();

        System.assertEquals('waking', r.archon.status);
        System.assertEquals(true, r.configured);
        System.assertEquals(0, mock.wakeCalls, 'MCP fan-out must wait until the Archon server answers');
        System.assert(!r.targets.isEmpty(), 'catalog + custom servers should be listed');
        for (ArchonWakeService.ServiceState t : r.targets) {
            System.assertEquals('pending', t.status, t.name);
        }
    }

    @IsTest
    static void archon_online_fans_out_and_maps_statuses_by_key() {
        seedSession();
        CustomMcpServer__c c = seedCustomServer('https://custom.example.com');
        String wakeBody = '{"server":{"commit":"abc"},"targets":[' +
            '{"key":"custom_' + c.Id + '","name":"Custom MCP","url":"https://custom.example.com","status":"online","ms":412},' +
            '{"key":"salesforce_mcp","status":"waking","ms":12000,"message":"No answer within 12s."}' +
            ']}';
        RoutedMock mock = new RoutedMock(200, '{"status":"ok","uptime":42.5,"commit":"1a2b3c4d5e6f"}', 200, wakeBody);
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        ArchonWakeService.WakeResult r = ArchonWakeService.wake();
        Test.stopTest();

        System.assertEquals('online', r.archon.status);
        System.assertEquals('build 1a2b3c4d5e6f, up 42s', r.archon.message);
        System.assertEquals(1, mock.wakeCalls);
        System.assert(mock.lastWakeBody.contains('https://custom.example.com'), 'custom server URL must be sent to the probe');

        ArchonWakeService.ServiceState custom;
        ArchonWakeService.ServiceState sfdc;
        for (ArchonWakeService.ServiceState t : r.targets) {
            if (t.key == 'custom_' + c.Id) custom = t;
            if (t.key == 'salesforce_mcp') sfdc = t;
        }
        System.assertNotEquals(null, custom);
        System.assertEquals('online', custom.status);
        System.assertEquals(412, custom.ms);
        if (sfdc != null) { // present only when the packaged catalog row is in the org
            System.assertEquals('waking', sfdc.status);
        }
    }

    @IsTest
    static void archon_online_but_not_authorized_leaves_targets_pending() {
        seedCustomServer('https://custom.example.com');
        RoutedMock mock = new RoutedMock(200, '{"status":"ok"}', 200, '{}');
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        ArchonWakeService.WakeResult r = ArchonWakeService.wake();
        Test.stopTest();

        System.assertEquals('online', r.archon.status);
        System.assertEquals(false, r.configured);
        System.assertEquals(0, mock.wakeCalls);
        for (ArchonWakeService.ServiceState t : r.targets) {
            System.assertEquals('pending', t.status);
        }
    }

    @IsTest
    static void fanout_timeout_marks_targets_waking() {
        seedSession();
        seedCustomServer('https://custom.example.com');
        RoutedMock mock = new RoutedMock(200, '{"status":"ok"}', 200, '{}');
        mock.throwOnWake = true;
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        ArchonWakeService.WakeResult r = ArchonWakeService.wake();
        Test.stopTest();

        for (ArchonWakeService.ServiceState t : r.targets) {
            System.assertEquals('waking', t.status);
        }
    }

    @IsTest
    static void fanout_404_means_old_server_build_not_waking() {
        seedSession();
        seedCustomServer('https://custom.example.com');
        RoutedMock mock = new RoutedMock(200, '{"status":"ok"}', 404, '<!DOCTYPE html><html><body>Cannot POST /api/connectors/wake</body></html>');
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        ArchonWakeService.WakeResult r = ArchonWakeService.wake();
        Test.stopTest();

        for (ArchonWakeService.ServiceState t : r.targets) {
            System.assertEquals('unreachable', t.status);
            System.assert(t.message.contains('deploy the latest server'), t.message);
        }
    }

    @IsTest
    static void health_4xx_is_unreachable_not_waking() {
        RoutedMock mock = new RoutedMock(404, '{"error":"not_found"}', 200, '{}');
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        ArchonWakeService.WakeResult r = ArchonWakeService.wake();
        Test.stopTest();

        System.assertEquals('unreachable', r.archon.status);
    }

    private static Map<String, Object> postSetup(String payload) {
        RestRequest req = new RestRequest();
        req.requestUri = '/services/apexrest/agent-builder/setup';
        req.httpMethod = 'POST';
        req.requestBody = Blob.valueOf(payload);
        RestContext.request = req;
        RestContext.response = new RestResponse();
        AgentSetupRestService.handlePost();
        return (Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString());
    }

    @IsTest
    static void rest_get_returns_local_status() {
        RestContext.request = new RestRequest();
        RestContext.response = new RestResponse();
        Test.startTest();
        AgentSetupRestService.getStatus();
        Test.stopTest();
        System.assertEquals(200, RestContext.response.statusCode);
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString());
        System.assertEquals(false, body.get('configured'));
    }

    @IsTest
    static void rest_rejects_missing_and_unknown_actions() {
        Test.startTest();
        Map<String, Object> noAction = postSetup('{}');
        Integer noActionCode = RestContext.response.statusCode;
        Map<String, Object> unknown = postSetup('{"action":"dance"}');
        Integer unknownCode = RestContext.response.statusCode;
        Test.stopTest();
        System.assertEquals(400, noActionCode);
        System.assert(((String) noAction.get('error')).contains('action'));
        System.assertEquals(400, unknownCode);
        System.assert(((String) unknown.get('error')).contains('dance'));
    }

    @IsTest
    static void rest_refresh_start_and_reset_round_trip() {
        Test.setMock(HttpCalloutMock.class, new RoutedMock(200, '{"status":"ok"}', 200,
            '{"configured":false,"authorizeUrl":"https://example.com/auth","sessionKey":"sk-x","ok":true}'));
        Test.startTest();
        Map<String, Object> refreshed = postSetup('{"action":"refresh"}');
        Map<String, Object> started = postSetup('{"action":"start","returnUrl":"https://acme.lightning.force.com/setup"}');
        Map<String, Object> reset = postSetup('{"action":"reset"}');
        Test.stopTest();
        System.assertEquals(false, refreshed.get('configured'));
        System.assertEquals('https://example.com/auth', started.get('authorizeUrl'));
        System.assertEquals(true, reset.get('success'));
    }

    @IsTest
    static void rest_wake_action_returns_result() {
        seedSession();
        Test.setMock(HttpCalloutMock.class, new RoutedMock(200, '{"status":"ok"}', 200, '{"targets":[]}'));
        RestRequest req = new RestRequest();
        req.requestUri = '/services/apexrest/agent-builder/setup';
        req.httpMethod = 'POST';
        req.requestBody = Blob.valueOf('{"action":"wake"}');
        RestContext.request = req;
        RestContext.response = new RestResponse();

        Test.startTest();
        AgentSetupRestService.handlePost();
        Test.stopTest();

        System.assertEquals(200, RestContext.response.statusCode);
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString());
        Map<String, Object> archon = (Map<String, Object>) body.get('archon');
        System.assertEquals('online', archon.get('status'));
    }
}
