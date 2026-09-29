// Prints the Gmail and Outlook sign-in links the server mints (no secrets; connects nothing).
for (String p : new List<String>{ 'gmail', 'outlook' }) {
    try {
        AgentConnectorController.StartOAuthResult r = AgentConnectorController.startOAuth(p, p, 'https://example.invalid/return');
        System.debug('OL ' + p + ' ' + r.authorizeUrl);
    } catch (Exception e) {
        System.debug('OL ' + p + ' FAILED ' + e.getMessage().left(300));
    }
}
