/**
 * AgentChatAttachmentController — accepts a base64 file from the chat LWC,
 * creates a ContentVersion (which auto-creates a ContentDocument), and links
 * it to the ChatSession so the file inherits the session's sharing rules.
 *
 * Files are stored in customer's own Salesforce org (no third-party storage).
 * The Node server later fetches the bytes via jsforce using the per-org OAuth
 * token to include in the LLM turn.
 */
@SuppressWarnings('PMD.ApexCRUDViolation')
public with sharing class AgentChatAttachmentController {

    private static final Integer MAX_BYTES = 6 * 1024 * 1024; // 6 MB — LWC caps at 5 MB, small buffer for base64 overhead

    @AuraEnabled
    public static UploadResult uploadChatFile(Id sessionId, String fileName, String mimeType, String base64) {
        if (sessionId == null) throw new AuraHandledException('sessionId is required.');
        if (String.isBlank(fileName)) throw new AuraHandledException('fileName is required.');
        if (String.isBlank(base64))   throw new AuraHandledException('File body is empty.');

        // Verify the caller can see the session — enforces record-level security.
        List<ChatSession__c> sess = [
            SELECT Id, Status__c FROM ChatSession__c WHERE Id = :sessionId WITH USER_MODE LIMIT 1
        ];
        if (sess.isEmpty()) throw new AuraHandledException('Session not found.');
        if (sess[0].Status__c != 'Active') throw new AuraHandledException('Session is not active.');

        Blob body;
        try {
            body = EncodingUtil.base64Decode(base64);
        } catch (Exception e) {
            throw new AuraHandledException('Invalid file encoding.');
        }
        if (body.size() > MAX_BYTES) throw new AuraHandledException('File exceeds the 5 MB limit.');

        ContentVersion cv = new ContentVersion();
        cv.Title           = fileName.left(255);
        cv.PathOnClient    = fileName.left(500);
        cv.VersionData     = body;
        cv.FirstPublishLocationId = null;
        insert cv;

        // Grab the auto-created ContentDocumentId AND the ContentVersion.Id.
        // Sending both to Node lets it skip a SOQL round-trip when fetching bytes.
        ContentVersion inserted = [
            SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id LIMIT 1
        ];

        ContentDocumentLink cdl = new ContentDocumentLink(
            ContentDocumentId = inserted.ContentDocumentId,
            LinkedEntityId    = sessionId,
            ShareType         = 'V',
            Visibility        = 'InternalUsers'
        );
        insert cdl;

        UploadResult r = new UploadResult();
        r.contentDocumentId = inserted.ContentDocumentId;
        r.contentVersionId  = inserted.Id;
        return r;
    }

    public class UploadResult {
        @AuraEnabled public Id contentDocumentId;
        @AuraEnabled public Id contentVersionId;
    }
}
