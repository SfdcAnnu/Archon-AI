/**
 * JwtSigner — mints HS256 JWTs that the Node.js execution server can verify.
 *
 * Secret lives in SynapseConfig__mdt.Default.JwtSecret__c, which must match
 * server/.env JWT_SECRET on the Node side.
 *
 * Token payload:
 *   - orgId
 *   - userId
 *   - agentApiName (optional — caller passes if relevant)
 *   - iat (issued-at, epoch seconds)
 *   - exp (expiry, iat + 5 minutes)
 */
public with sharing class JwtSigner {

    @TestVisible private static String overrideSecret;
    private static final Integer TTL_SECONDS = 300;

    /**
     * Mint a JWT and return the full Bearer header value: "Bearer <token>".
     * Throws AuraHandledException if the secret isn't configured.
     */
    public static String mintBearer(String agentApiName) {
        String secret = getSecret();
        if (String.isBlank(secret) || secret.startsWith('REPLACE_ME')) {
            throw new AuraHandledException(
                'Synapse Config JWT Secret is not set. Setup → Custom Metadata Types → Synapse Config → Manage Records → Default → edit JwtSecret__c.'
            );
        }

        Long now = DateTime.now().getTime() / 1000;
        Map<String, Object> claims = new Map<String, Object>{
            'orgId'        => UserInfo.getOrganizationId(),
            'userId'       => UserInfo.getUserId(),
            'agentApiName' => agentApiName,
            'iat'          => now,
            'exp'          => now + TTL_SECONDS
        };

        return 'Bearer ' + signHs256(claims, secret);
    }

    /** Sign a claims map as a JWT with HS256. Returns the compact token "header.payload.signature". */
    @TestVisible
    private static String signHs256(Map<String, Object> claims, String secret) {
        Map<String, Object> header = new Map<String, Object>{ 'alg' => 'HS256', 'typ' => 'JWT' };

        String headerB64  = base64Url(Blob.valueOf(JSON.serialize(header)));
        String payloadB64 = base64Url(Blob.valueOf(JSON.serialize(claims)));
        String signingInput = headerB64 + '.' + payloadB64;

        Blob mac = Crypto.generateMac(
            'HmacSHA256',
            Blob.valueOf(signingInput),
            Blob.valueOf(secret)
        );

        return signingInput + '.' + base64Url(mac);
    }

    /** Base64url = base64, then +/= → -_<strip>. */
    private static String base64Url(Blob b) {
        String s = EncodingUtil.base64Encode(b);
        return s.replace('+', '-').replace('/', '_').replace('=', '');
    }

    private static String getSecret() {
        if (overrideSecret != null) return overrideSecret;
        List<SynapseConfig__mdt> rows = [
            SELECT JwtSecret__c FROM SynapseConfig__mdt
            WHERE DeveloperName = 'Default'
            LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0].JwtSecret__c;
    }
}
