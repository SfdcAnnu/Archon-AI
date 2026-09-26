// Can the server mint a sign-in link for Gmail and Outlook? (Mints a URL only; connects nothing.)
for (String p : new List<String>{ 'gmail', 'outlook' }) {
    try {
        AgentConnectorController.StartOAuthResult r = AgentConnectorController.startOAuth(p, p, 'https://example.invalid/return');
        System.debug('OAUTH ' + p + ' ok url=' + (r.authorizeUrl == null ? 'null' : r.authorizeUrl.left(120)));
    } catch (Exception e) {
        System.debug('OAUTH ' + p + ' FAILED ' + e.getMessage().left(300));
    }
}
