import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { loadScript } from 'lightning/platformResourceLoader';
import MARKED     from '@salesforce/resourceUrl/Synapse_marked';
import DOMPURIFY  from '@salesforce/resourceUrl/Synapse_DOMPurify';
import startSession from '@salesforce/apex/AgentChatController.startSession';
import getSession   from '@salesforce/apex/AgentChatController.getSession';
import sendTurn     from '@salesforce/apex/AgentChatController.sendTurn';
import endSession   from '@salesforce/apex/AgentChatController.endSession';
import uploadChatFile from '@salesforce/apex/AgentChatAttachmentController.uploadChatFile';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_ATTACHMENTS_PER_TURN = 5;

export default class SynapseChatPanel extends LightningElement {
    @api agentApiName;
    @api recordContextId;
    @api recordContextType;
    @api sessionId;

    @track session = null;
    @track messages = [];
    @track input = '';
    @track sending = false;
    @track loading = false;
    @track pendingAttachments = [];   // [{ id, name, size, mimeType, isImage, previewUrl, contentDocumentId, uploading }]
    @track isRecording = false;

    mdReady = false;
    _libsLoading = null;
    _recognition = null;
    _voiceSupported = false;

    connectedCallback() {
        this.setupSpeechRecognition();
        this.loadMarkdownLibs().then(() => this.bootstrap());
    }

    disconnectedCallback() {
        this.stopVoiceRecognition();
    }

    // ── Markdown libs ──────────────────────────────────────────────

    loadMarkdownLibs() {
        if (this.mdReady) return Promise.resolve();
        if (this._libsLoading) return this._libsLoading;
        this._libsLoading = Promise.all([
            loadScript(this, MARKED),
            loadScript(this, DOMPURIFY),
        ]).then(() => {
            if (window.marked && typeof window.marked.setOptions === 'function') {
                window.marked.setOptions({
                    gfm: true,
                    breaks: true,
                    headerIds: false,
                    mangle: false,
                });
            }
            this.mdReady = true;
        }).catch(err => {
            // eslint-disable-next-line no-console
            console.error('markdown lib load failed', err);
        });
        return this._libsLoading;
    }

    renderMarkdown(raw) {
        if (!raw) return '';
        if (!this.mdReady || !window.marked || !window.DOMPurify) {
            return this.escapeHtml(raw).replace(/\n/g, '<br>');
        }
        const dirty = window.marked.parse(String(raw));
        return window.DOMPurify.sanitize(dirty, {
            ALLOWED_TAGS: [
                'p','br','strong','em','b','i','u','s','del','sub','sup',
                'h1','h2','h3','h4','h5','h6',
                'ul','ol','li',
                'blockquote','hr',
                'code','pre',
                'a',
                'table','thead','tbody','tfoot','tr','th','td',
                'span','div',
            ],
            ALLOWED_ATTR: ['href','title','target','rel','align','colspan','rowspan','class'],
            ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
            FORBID_TAGS: ['script','style','iframe','object','embed','form','input','textarea','select','button'],
            FORBID_ATTR: ['onerror','onload','onclick','onmouseover','onfocus','onblur','style'],
        });
    }

    escapeHtml(s) {
        return String(s)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    // ── Bootstrap ──────────────────────────────────────────────────

    async bootstrap() {
        this.loading = true;
        try {
            const result = this.sessionId
                ? await getSession({ sessionId: this.sessionId })
                : await startSession({
                      agentApiName:      this.agentApiName,
                      recordContextId:   this.recordContextId,
                      recordContextType: this.recordContextType
                  });
            this.session  = result.session;
            this.messages = result.messages || [];
        } catch (err) {
            this.toastError('Could not load chat', err);
        } finally {
            this.loading = false;
            this.scrollToBottom();
        }
    }

    // ── Derived rendering data ─────────────────────────────────────

    get displayedMessages() {
        return this.messages
            .filter(m => m.Role__c !== 'System')
            .map(m => {
                const role = m.Role__c;
                const isUser   = role === 'User';
                const isAssist = role === 'Assistant';
                const isTool   = role === 'Tool';
                let toolLabel = null;
                if (isTool) {
                    try {
                        const j = JSON.parse(m.ToolCallsJson__c || '{}');
                        toolLabel = j.name || 'tool';
                    } catch { toolLabel = 'tool'; }
                }
                return {
                    id: m.Id,
                    role,
                    isUser, isAssist, isTool,
                    cssClass: `msg msg-${role.toLowerCase()}`,
                    content: m.Content__c || '',
                    toolLabel,
                    timestamp: m.CreatedDate
                };
            });
    }

    get hasMessages() { return this.displayedMessages.length > 0; }
    get showEmptyHint() { return !this.loading && this.displayedMessages.length === 0 && !this.sessionEndedNotice; }

    get inputDisabled() {
        return this.sending || !this.session || this.session.Status__c !== 'Active';
    }
    get attachDisabled() {
        return this.inputDisabled || this.pendingAttachments.length >= MAX_ATTACHMENTS_PER_TURN;
    }
    get hasText()      { return !!(this.input && this.input.trim()); }
    get hasAttachments() { return this.pendingAttachments.length > 0; }
    get hasPendingAttachments() { return this.hasAttachments; }
    get anyAttachmentUploading() { return this.pendingAttachments.some(a => a.uploading); }
    get sendDisabled() {
        return this.inputDisabled
            || this.anyAttachmentUploading
            || (!this.hasText && !this.hasAttachments);
    }

    /** Show typing bubble while we're waiting on the server AND the latest message is from the user. */
    get showTypingIndicator() {
        if (!this.sending) return false;
        const displayed = this.displayedMessages;
        if (displayed.length === 0) return true;
        const last = displayed[displayed.length - 1];
        return last.isUser;
    }

    get headerLabel() {
        if (!this.session) return 'Chat';
        const agentName = this.session.AgentDefinition__r?.Name || this.agentApiName;
        if (this.recordContextType) return `${agentName} · ${this.recordContextType}`;
        return agentName;
    }

    get sessionEndedNotice() {
        return this.session && this.session.Status__c !== 'Active'
            ? `This session is ${this.session.Status__c.toLowerCase()}. Start a new chat to continue.`
            : null;
    }

    // ── Voice input (Web Speech API) ───────────────────────────────

    get voiceSupported() { return this._voiceSupported; }
    get micIcon()   { return this.isRecording ? 'utility:muted' : 'utility:unmuted'; }
    get micVariant(){ return this.isRecording ? 'brand'         : 'border-filled'; }
    get micLabel()  { return this.isRecording ? 'Stop recording' : 'Voice input'; }
    get micDisabled(){ return this.inputDisabled; }
    get micClass()  { return this.isRecording ? 'mic-btn recording' : 'mic-btn'; }

    setupSpeechRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            this._voiceSupported = false;
            return;
        }
        this._voiceSupported = true;
        this._recognition = new SR();
        this._recognition.continuous     = true;
        this._recognition.interimResults = true;
        this._recognition.lang           = navigator.language || 'en-US';

        let baseText = '';
        this._recognition.onstart = () => {
            baseText = this.input || '';
            this.isRecording = true;
        };
        this._recognition.onresult = (event) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            const combined = (baseText + (baseText && !baseText.endsWith(' ') ? ' ' : '') + transcript).trimStart();
            this.input = combined;
            if (this.refs?.inputBox) this.refs.inputBox.value = combined;
        };
        this._recognition.onerror = (event) => {
            this.isRecording = false;
            // 'no-speech' and 'aborted' are routine — don't toast for those.
            if (event.error && event.error !== 'no-speech' && event.error !== 'aborted') {
                this.toast('Voice input', `Recognition error: ${event.error}`, 'warning');
            }
        };
        this._recognition.onend = () => { this.isRecording = false; };
    }

    handleMicClick() {
        if (!this._recognition) return;
        if (this.isRecording) {
            try { this._recognition.stop(); } catch { /* ignore */ }
        } else {
            try {
                this._recognition.start();
            } catch (e) {
                this.toast('Voice input', 'Could not start microphone. Check browser permissions.', 'warning');
            }
        }
    }

    stopVoiceRecognition() {
        if (this._recognition && this.isRecording) {
            try { this._recognition.stop(); } catch { /* ignore */ }
        }
    }

    // ── File attachments ───────────────────────────────────────────

    handleAttachClick() {
        if (this.refs?.fileInput) this.refs.fileInput.click();
    }

    async handleFilesPicked(event) {
        const files = Array.from(event.target.files || []);
        // Reset the input so the same file can be picked again after removal.
        event.target.value = '';

        for (const file of files) {
            if (this.pendingAttachments.length >= MAX_ATTACHMENTS_PER_TURN) {
                this.toast('Attachments', `Max ${MAX_ATTACHMENTS_PER_TURN} files per message.`, 'warning');
                return;
            }
            if (file.size > MAX_ATTACHMENT_BYTES) {
                this.toast('File too large', `${file.name} exceeds the 5 MB limit.`, 'warning');
                continue;
            }
            const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const isImage = /^image\//.test(file.type);
            const previewUrl = isImage ? URL.createObjectURL(file) : null;
            const entry = {
                id,
                name: file.name,
                size: file.size,
                mimeType: file.type || 'application/octet-stream',
                isImage,
                previewUrl,
                contentDocumentId: null,
                uploading: true
            };
            this.pendingAttachments = [...this.pendingAttachments, entry];

            try {
                const base64 = await this.readAsBase64(file);
                const uploadRes = await uploadChatFile({
                    sessionId: this.session.Id,
                    fileName:  file.name,
                    mimeType:  entry.mimeType,
                    base64:    base64
                });
                const ext = (file.name.split('.').pop() || '').toLowerCase();
                this.pendingAttachments = this.pendingAttachments.map(a =>
                    a.id === id
                        ? {
                            ...a,
                            contentDocumentId: uploadRes.contentDocumentId,
                            contentVersionId:  uploadRes.contentVersionId,
                            fileExtension:     ext,
                            uploading: false
                          }
                        : a
                );
            } catch (err) {
                this.pendingAttachments = this.pendingAttachments.filter(a => a.id !== id);
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                this.toastError('Upload failed', err);
            }
        }
    }

    handleRemoveAttachment(event) {
        const id = event.currentTarget.dataset.id;
        const att = this.pendingAttachments.find(a => a.id === id);
        if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
        this.pendingAttachments = this.pendingAttachments.filter(a => a.id !== id);
    }

    readAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => {
                const dataUrl = reader.result;
                const commaIx = dataUrl.indexOf(',');
                resolve(commaIx >= 0 ? dataUrl.slice(commaIx + 1) : dataUrl);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    // ── Render assistant markdown after DOM updates ────────────────

    renderedCallback() {
        if (!this.mdReady) return;
        const nodes = this.template.querySelectorAll('[data-md-id]');
        for (const el of nodes) {
            const id = el.dataset.mdId;
            if (el.dataset.mdRendered === id) continue;
            const msg = this.messages.find(m => m.Id === id);
            if (!msg) continue;
            el.innerHTML = this.renderMarkdown(msg.Content__c || '');
            el.dataset.mdRendered = id;
        }
    }

    // ── Input ──────────────────────────────────────────────────────

    handleInputChange(e) { this.input = e.target.value; }

    handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSend();
        }
    }

    async handleSend() {
        if (this.sendDisabled) return;
        this.stopVoiceRecognition();

        const text = (this.input || '').trim();
        const attachmentPayload = this.pendingAttachments
            .filter(a => a.contentDocumentId && a.contentVersionId)
            .map(a => ({
                contentDocumentId: a.contentDocumentId,
                contentVersionId:  a.contentVersionId,
                fileName:          a.name,
                mimeType:          a.mimeType,
                fileExtension:     a.fileExtension || ''
            }));
        const attachmentSummaries = this.pendingAttachments.map(a => ({
            id: a.contentDocumentId,
            name: a.name,
            mimeType: a.mimeType,
            isImage: a.isImage,
            previewUrl: a.previewUrl
        }));

        // Reset input UI
        this.input = '';
        if (this.refs?.inputBox) this.refs.inputBox.value = '';
        const attachedThisTurn = this.pendingAttachments;
        this.pendingAttachments = [];
        this.sending = true;

        const tempId = `tmp_${Date.now()}`;
        const optimisticContent = text || (attachmentSummaries.length > 0 ? `[${attachmentSummaries.length} attachment${attachmentSummaries.length > 1 ? 's' : ''}]` : '');
        this.messages = [
            ...this.messages,
            {
                Id: tempId,
                Role__c: 'User',
                Content__c: optimisticContent,
                _localAttachments: attachmentSummaries
            }
        ];
        this.scrollToBottom();

        try {
            const result = await sendTurn({
                sessionId:   this.session.Id,
                userText:    text,
                attachments: attachmentPayload
            });
            this.handleTurnResult(result);
        } catch (err) {
            const errText = err?.body?.message || err?.message || 'Unknown error';
            this.messages = [
                ...this.messages,
                {
                    Id: `tmp_err_${Date.now()}`,
                    Role__c: 'Assistant',
                    Content__c: '⚠ ' + errText,
                    _localError: true
                }
            ];
            this.toastError('Send failed', err);
        } finally {
            // Release the browser blob URLs for the previews we just sent
            for (const a of attachedThisTurn) {
                if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
            }
            this.sending = false;
            this.scrollToBottom();
        }
    }

    handleTurnResult(result) {
        this.messages = this.messages.filter(m => !String(m.Id).startsWith('tmp_'));
        this.messages = [...this.messages, ...(result.newMessages || [])];
        this.session = result.session;
        if (result.status === 'error') {
            this.toast(
                'Chat error',
                'The AI service returned an error. See the assistant reply for details.',
                'warning'
            );
        }
        // Tell the parent workspace to refresh the sidebar so title/turn count
        // stay in sync. Fire once immediately (turn count + last-activity) and
        // again after ~5s to catch the async title update on turn 3.
        this.dispatchEvent(new CustomEvent('sessionchange', {
            detail: { turnCompleted: true, sessionId: this.session?.Id }
        }));
        setTimeout(() => {
            this.dispatchEvent(new CustomEvent('sessionchange', {
                detail: { turnCompleted: true, sessionId: this.session?.Id, titleCheck: true }
            }));
        }, 5000);
        this.scrollToBottom();
    }

    // ── End session ────────────────────────────────────────────────

    async handleEnd() {
        if (!confirm('End this chat? You will start fresh next time.')) return;
        try {
            await endSession({ sessionId: this.session.Id });
            this.toast('Chat ended', 'Session closed.', 'success');
            this.dispatchEvent(new CustomEvent('sessionchange', { detail: { ended: true } }));
            await this.bootstrap();
        } catch (err) {
            this.toastError('Could not end session', err);
        }
    }

    // ── Helpers ────────────────────────────────────────────────────

    scrollToBottom() {
        Promise.resolve().then(() => {
            const list = this.template.querySelector('.msg-list');
            if (list) list.scrollTop = list.scrollHeight;
        });
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant: variant || 'info' }));
    }
    toastError(title, err) {
        const msg = err?.body?.message || err?.message || 'Unknown error';
        this.toast(title, msg, 'error');
    }
}
