/**
 * Apex REST aggregate for the Home dashboard: activity per day and per
 * agent across BOTH kinds of work the platform does — automation runs
 * (AgentExecution__c) and chat turns (ChatMessage__c, Role Assistant) —
 * org-wide, in the running user's timezone.
 *
 * One request replaces paging 200 runs and one user's sessions on the
 * client. Chat failures are counted from ChatMessage__c.TurnStatus__c,
 * which the server writes for every turn; rows from before the field
 * existed have it blank and are read as Complete.
 */
@RestResource(urlMapping='/agent-builder/home-stats')
global with sharing class AgentHomeStatsRestService {

    global class DayCount {
        public String day;
        public Integer runsOk = 0;
        public Integer runsFailed = 0;
        public Integer runsOther = 0;
        public Integer turnsOk = 0;
        public Integer turnsFailed = 0;
    }

    global class AgentCount {
        public String apiName;
        public String name;
        public Integer runsToday = 0;
        public Integer runsFailedToday = 0;
        public Integer turnsToday = 0;
        public Integer turnsFailedToday = 0;
        /** Tokens over the whole window, not just today. */
        public Long tokensIn = 0;
        public Long tokensOut = 0;
    }

    global class Stats {
        public Integer days;
        public List<DayCount> byDay = new List<DayCount>();
        public List<AgentCount> byAgent = new List<AgentCount>();
        public Integer runs = 0;
        public Integer runsFailed = 0;
        public Integer turns = 0;
        public Integer turnsFailed = 0;
        public Long tokensIn = 0;
        public Long tokensOut = 0;
        public String generatedAt;
    }

    @HttpGet
    global static void handleGet() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            Integer days = 7;
            String raw = req.params.get('days');
            if (String.isNotBlank(raw)) {
                try { days = Integer.valueOf(raw); } catch (Exception e) { days = 7; }
            }
            days = Math.max(1, Math.min(31, days));
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(build(days)));
        } catch (Exception e) {
            res.statusCode = 400;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => e.getMessage() }));
        }
    }

    public static Stats build(Integer days) {
        Stats s = new Stats();
        s.days = days;
        s.generatedAt = Datetime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');

        // The window starts at local midnight (days - 1) days ago, so the last
        // bucket is today in the user's timezone — the same day the browser
        // shows as "today".
        Date startDate = Date.today().addDays(-(days - 1));
        Datetime startDt = Datetime.newInstance(startDate, Time.newInstance(0, 0, 0, 0));
        Map<String, Object> binds = new Map<String, Object>{ 'startDt' => startDt };

        Map<String, DayCount> byDay = new Map<String, DayCount>();
        for (Integer i = 0; i < days; i++) {
            DayCount dc = new DayCount();
            dc.day = String.valueOf(startDate.addDays(i));
            byDay.put(dc.day, dc);
            s.byDay.add(dc);
        }

        // ── runs per day ─────────────────────────────────────────────
        for (AggregateResult ar : (List<AggregateResult>) Database.queryWithBinds(
            'SELECT DAY_ONLY(convertTimezone(CreatedDate)) d, Status__c st, COUNT(Id) c ' +
            'FROM AgentExecution__c WHERE CreatedDate >= :startDt ' +
            'GROUP BY DAY_ONLY(convertTimezone(CreatedDate)), Status__c',
            binds, AccessLevel.USER_MODE)) {
            DayCount dc = byDay.get(String.valueOf((Date) ar.get('d')));
            if (dc == null) continue;
            String st = (String) ar.get('st');
            Integer c = (Integer) ar.get('c');
            if (st == 'SUCCESS') dc.runsOk += c;
            else if (st == 'ERROR' || st == 'TIMEOUT') dc.runsFailed += c;
            else dc.runsOther += c;
        }

        // ── chat turns per day ───────────────────────────────────────
        for (AggregateResult ar : (List<AggregateResult>) Database.queryWithBinds(
            'SELECT DAY_ONLY(convertTimezone(CreatedDate)) d, TurnStatus__c st, COUNT(Id) c ' +
            'FROM ChatMessage__c WHERE Role__c = \'Assistant\' AND CreatedDate >= :startDt ' +
            'GROUP BY DAY_ONLY(convertTimezone(CreatedDate)), TurnStatus__c',
            binds, AccessLevel.USER_MODE)) {
            DayCount dc = byDay.get(String.valueOf((Date) ar.get('d')));
            if (dc == null) continue;
            Integer c = (Integer) ar.get('c');
            if ((String) ar.get('st') == 'Failed') dc.turnsFailed += c; else dc.turnsOk += c;
        }

        for (DayCount dc : s.byDay) {
            s.runs += dc.runsOk + dc.runsFailed + dc.runsOther;
            s.runsFailed += dc.runsFailed;
            s.turns += dc.turnsOk + dc.turnsFailed;
            s.turnsFailed += dc.turnsFailed;
        }

        // ── per agent ────────────────────────────────────────────────
        Map<String, AgentCount> byAgent = new Map<String, AgentCount>();

        for (AggregateResult ar : (List<AggregateResult>) Database.queryWithBinds(
            'SELECT AgentDefinition__r.ApiName__c a, AgentDefinition__r.Name n, Status__c st, COUNT(Id) c ' +
            'FROM AgentExecution__c WHERE CreatedDate = TODAY ' +
            'GROUP BY AgentDefinition__r.ApiName__c, AgentDefinition__r.Name, Status__c',
            binds, AccessLevel.USER_MODE)) {
            AgentCount ac = agentRow(byAgent, s, (String) ar.get('a'), (String) ar.get('n'));
            Integer c = (Integer) ar.get('c');
            String st = (String) ar.get('st');
            ac.runsToday += c;
            if (st == 'ERROR' || st == 'TIMEOUT') ac.runsFailedToday += c;
        }

        for (AggregateResult ar : (List<AggregateResult>) Database.queryWithBinds(
            'SELECT ChatSession__r.AgentDefinition__r.ApiName__c a, ChatSession__r.AgentDefinition__r.Name n, TurnStatus__c st, COUNT(Id) c ' +
            'FROM ChatMessage__c WHERE Role__c = \'Assistant\' AND CreatedDate = TODAY ' +
            'GROUP BY ChatSession__r.AgentDefinition__r.ApiName__c, ChatSession__r.AgentDefinition__r.Name, TurnStatus__c',
            binds, AccessLevel.USER_MODE)) {
            AgentCount ac = agentRow(byAgent, s, (String) ar.get('a'), (String) ar.get('n'));
            Integer c = (Integer) ar.get('c');
            ac.turnsToday += c;
            if ((String) ar.get('st') == 'Failed') ac.turnsFailedToday += c;
        }

        for (AggregateResult ar : (List<AggregateResult>) Database.queryWithBinds(
            'SELECT ChatSession__r.AgentDefinition__r.ApiName__c a, ChatSession__r.AgentDefinition__r.Name n, SUM(TokensIn__c) ti, SUM(TokensOut__c) tout ' +
            'FROM ChatMessage__c WHERE Role__c = \'Assistant\' AND CreatedDate >= :startDt ' +
            'GROUP BY ChatSession__r.AgentDefinition__r.ApiName__c, ChatSession__r.AgentDefinition__r.Name',
            binds, AccessLevel.USER_MODE)) {
            AgentCount ac = agentRow(byAgent, s, (String) ar.get('a'), (String) ar.get('n'));
            Long ti = toLong(ar.get('ti'));
            Long tout = toLong(ar.get('tout'));
            ac.tokensIn += ti;
            ac.tokensOut += tout;
            s.tokensIn += ti;
            s.tokensOut += tout;
        }

        return s;
    }

    private static AgentCount agentRow(Map<String, AgentCount> byAgent, Stats s, String apiName, String name) {
        String key = String.isBlank(apiName) ? '(unknown)' : apiName;
        AgentCount ac = byAgent.get(key);
        if (ac == null) {
            ac = new AgentCount();
            ac.apiName = key;
            ac.name = String.isBlank(name) ? key : name;
            byAgent.put(key, ac);
            s.byAgent.add(ac);
        }
        return ac;
    }

    private static Long toLong(Object v) {
        if (v == null) return 0;
        return ((Decimal) v).longValue();
    }
}
