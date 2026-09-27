/**
 * SendWhatsAppMessage — a Flow-friendly "Send WhatsApp Message" action.
 *
 * 360 SMS does ship an invocable (tdc_tsw__GlobalSMSSender), but it takes a
 * single opaque packed string, which is unusable from a Flow builder. This
 * wraps the package's own typed global method — the same call the WhatsApp
 * bridge already uses for agent replies — behind three plain inputs.
 *
 * Related-record rule, carried over from the bridge deliberately: an
 * OUTGOING message relates to the PERSON (Contact or Lead), never to the
 * Opportunity. 360 SMS threads its Conversation View on the person record,
 * and the customer's incoming messages already relate there — relating the
 * reply anywhere else splits the thread in two.
 *
 * Callout rules are the same as any other: from a record-triggered Flow,
 * call this on the "Run Asynchronously" path.
 */
public with sharing class SendWhatsAppMessage {

    public class Request {
        @InvocableVariable(
            label='Phone Number'
            description='Recipient number in the format 360 SMS expects, e.g. +919876543210.'
            required=true
        )
        public String phoneNumber;

        @InvocableVariable(
            label='Message Text'
            description='The message body — typically the Response Text returned by Call AI Agent.'
            required=true
        )
        public String messageText;

        @InvocableVariable(
            label='Related Record Id (Contact or Lead)'
            description='The PERSON record the message belongs to. 360 SMS threads its Conversation View on this record, so use the Contact or Lead — not the Opportunity.'
        )
        public String relatedRecordId;
    }

    public class Result {
        @InvocableVariable(label='Success')       public Boolean success;
        @InvocableVariable(label='Error Message') public String  errorMessage;
    }

    @InvocableMethod(
        label='Send WhatsApp Message'
        description='Sends a WhatsApp/SMS message through 360 SMS. Pair it with Call AI Agent to reply with an agent response. Makes a callout — from record-triggered Flows, use the Run Asynchronously path.'
        callout=true
        category='Agent Builder'
    )
    public static List<Result> send(List<Request> requests) {
        List<Result> results = new List<Result>();
        if (requests == null) return results;

        for (Request req : requests) {
            Result r = new Result();
            r.success = false;
            try {
                if (req == null || String.isBlank(req.phoneNumber)) {
                    r.errorMessage = 'Pass a Phone Number.';
                } else if (String.isBlank(req.messageText)) {
                    // Silently sending an empty message looks like success
                    // and tells the customer nothing — fail loudly instead.
                    r.errorMessage = 'Pass a Message Text — there is nothing to send.';
                } else {
                    tdc_tsw.GlobalSMSSender.sendSmsWithPhoneNumberAndMessageText(
                        req.phoneNumber.trim(),
                        req.messageText,
                        String.isNotBlank(req.relatedRecordId) ? req.relatedRecordId.trim() : null
                    );
                    r.success = true;
                }
            } catch (Exception e) {
                r.errorMessage = e.getMessage();
            }
            results.add(r);
        }
        return results;
    }
}
