// Can the server mint a sign-in link for Gmail and Outlook? (Mints a URL only; connects nothing.)
for (String p : new List<String>{ 'gmail', 'outlook' }) {
    try {
        AgentConnectorController.StartOAuthResult r = AgentConnectorController.startOAuth(p, p, 'https://example.invalid/return');
        String redirect = new PageReference(r.authorizeUrl).getParameters().get('redirect_uri');
        System.debug('OAUTH ' + p + ' redirect_uri=' + EncodingUtil.urlDecode(redirect == null ? '' : redirect, 'UTF-8'));
    } catch (Exception e) {
        System.debug('OAUTH ' + p + ' FAILED ' + e.getMessage().left(300));
    }
}
