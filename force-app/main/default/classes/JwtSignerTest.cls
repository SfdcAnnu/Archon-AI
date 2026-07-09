@IsTest
private class JwtSignerTest {

    @IsTest
    static void mintBearer_returns_three_segment_token() {
        JwtSigner.overrideSecret = 'test-secret-for-unit-test';

        Test.startTest();
        String bearer = JwtSigner.mintBearer('test_agent');
        Test.stopTest();

        System.assert(bearer.startsWith('Bearer '), 'Should be prefixed with Bearer');
        String token = bearer.substringAfter('Bearer ').trim();
        System.assertEquals(3, token.split('\\.').size(), 'JWT should have 3 base64url-encoded segments');
    }

    @IsTest
    static void mintBearer_throws_when_secret_blank() {
        JwtSigner.overrideSecret = '';

        Test.startTest();
        Boolean threw = false;
        try {
            JwtSigner.mintBearer('x');
        } catch (Exception e) {
            threw = true;
        }
        Test.stopTest();
        System.assertEquals(true, threw, 'Should throw when secret is blank');
    }

    @IsTest
    static void mintBearer_throws_when_secret_is_placeholder() {
        JwtSigner.overrideSecret = 'REPLACE_ME_WITH_SAME_SECRET_AS_SERVER_ENV';

        Test.startTest();
        Boolean threw = false;
        try {
            JwtSigner.mintBearer('x');
        } catch (Exception e) {
            threw = true;
        }
        Test.stopTest();
        System.assertEquals(true, threw, 'Should throw when secret is still the seed placeholder');
    }

    @IsTest
    static void signHs256_payload_decodes_back_to_claims() {
        Map<String, Object> claims = new Map<String, Object>{ 'orgId' => 'org-1', 'iat' => 1700000000 };

        Test.startTest();
        String token = JwtSigner.signHs256(claims, 'shh');
        Test.stopTest();

        String payloadB64 = token.split('\\.')[1];
        // base64url → base64 padding
        String padded = payloadB64.replace('-', '+').replace('_', '/');
        Integer mod = Math.mod(padded.length(), 4);
        if (mod > 0) padded += '===='.substring(0, 4 - mod);
        String payloadJson = EncodingUtil.base64Decode(padded).toString();
        Map<String, Object> decoded = (Map<String, Object>) JSON.deserializeUntyped(payloadJson);
        System.assertEquals('org-1', decoded.get('orgId'));
    }
}
