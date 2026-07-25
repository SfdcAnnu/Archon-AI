import { LightningElement, api, track } from 'lwc';
import getStorageConfig  from '@salesforce/apex/AgentKbController.getStorageConfig';
import saveStorageConfig from '@salesforce/apex/AgentKbController.saveStorageConfig';
import testConnection    from '@salesforce/apex/AgentKbController.testConnection';
import getDocuments      from '@salesforce/apex/AgentKbController.getDocuments';
import uploadDocument    from '@salesforce/apex/AgentKbController.uploadDocument';
import reindexDocument   from '@salesforce/apex/AgentKbController.reindexDocument';
import deleteDocument    from '@salesforce/apex/AgentKbController.deleteDocument';

const BACKEND_OPTIONS = [
    {
        value: 'archon',
        label: 'Archon default (hosted for you)',
        hint: "Fastest to set up — documents and their vectors are stored in Archon's own database, isolated per org."
    },
    {
        value: 'external_pg',
        label: 'Your own Postgres',
        hint: 'Bring your own Postgres with the pgvector extension — content and vectors live entirely in your database, never in Archon\'s.'
    },
    {
        value: 'salesforce',
        label: 'Your Salesforce org',
        hint: "Content is written as records in your own org — it never leaves Salesforce. Search is keyword-based (SOSL), not true vector similarity."
    }
];

/**
 * Knowledge base modal — Notes (plain text, always included verbatim) and
 * Documents (real RAG: chunked, embedded, retrieved by relevance) tabs.
 * Storage backend is a per-org choice made here; see AgentKbController /
 * the server's kb/backends/* for what each option actually does.
 */
export default class AgentKbModal extends LightningElement {
    @api open = false;
    @api agentName = '';
    @api agentApiName = '';
    @api agentRecordId = '';
    @api notesValue = '';

    @track activeTab = 'notes';

    get isNotesTab()     { return this.activeTab === 'notes'; }
    get isDocumentsTab() { return this.activeTab === 'documents'; }
    get notesTabClass()     { return this.isNotesTab ? 'kbm-tab kbm-tab--on' : 'kbm-tab'; }
    get documentsTabClass() { return this.isDocumentsTab ? 'kbm-tab kbm-tab--on' : 'kbm-tab'; }

    get canManageDocuments() { return !!this.agentRecordId && !!this.agentApiName; }

    handleTabClick(e) { this.activeTab = e.currentTarget.dataset.tab; }

    handleNotesChange(e) {
        this.dispatchEvent(new CustomEvent('noteschange', { detail: { value: e.target.value } }));
    }

    handleClose() { this.dispatchEvent(new CustomEvent('close')); }
    stop(e) { e.stopPropagation(); }

    // ── Documents tab ──────────────────────────────────────
    @track _documents = [];
    @track _docsLoading = false;
    @track _docsError = null;
    _docsLoadedForAgent = null;

    @track _storageConfig = { backend: 'archon', connectionUrlMasked: null, hasConnectionUrl: false };
    _storageLoadedForAgent = null;

    @track _selectedBackend = 'archon';
    @track _connectionUrlInput = '';
    @track _testingConnection = false;
    @track _testResult = null; // { ok, message }
    @track _savingBackend = false;

    @track _newDocTitle = '';
    @track _newDocText = '';
    @track _uploading = false;
    @track _uploadError = null;

    renderedCallback() {
        if (!this.isDocumentsTab || !this.canManageDocuments) return;
        if (this._docsLoadedForAgent !== this.agentApiName) {
            this._docsLoadedForAgent = this.agentApiName;
            this.loadDocuments();
        }
        if (this._storageLoadedForAgent !== this.agentApiName) {
            this._storageLoadedForAgent = this.agentApiName;
            this.loadStorageConfig();
        }
    }

    async loadDocuments() {
        this._docsLoading = true;
        this._docsError = null;
        try {
            this._documents = await getDocuments({ agentApiName: this.agentApiName });
        } catch (e) {
            this._docsError = e?.body?.message || e?.message || 'Could not load documents.';
        } finally {
            this._docsLoading = false;
        }
    }

    async loadStorageConfig() {
        try {
            const cfg = await getStorageConfig();
            this._storageConfig = cfg;
            this._selectedBackend = cfg.backend;
        } catch (e) {
            // Non-fatal — defaults stay, admin can still pick + save.
        }
    }

    get backendRows() {
        return BACKEND_OPTIONS.map(o => ({
            ...o,
            rowClass: o.value === this._selectedBackend ? 'kbm-backend-row kbm-backend-row--on' : 'kbm-backend-row',
            radioClass: o.value === this._selectedBackend ? 'kbm-radio kbm-radio--on' : 'kbm-radio'
        }));
    }
    get showConnectionUrlField() { return this._selectedBackend === 'external_pg'; }
    get testResultClass() {
        return this._testResult?.ok ? 'kbm-test-result kbm-test-result--ok' : 'kbm-test-result kbm-test-result--error';
    }

    handleBackendSelect(e) {
        this._selectedBackend = e.currentTarget.dataset.value;
        this._testResult = null;
    }
    handleConnectionUrlChange(e) {
        this._connectionUrlInput = e.target.value;
        this._testResult = null;
    }

    async handleTestConnection() {
        if (!this._connectionUrlInput.trim()) return;
        this._testingConnection = true;
        this._testResult = null;
        try {
            await testConnection({ connectionUrl: this._connectionUrlInput.trim() });
            this._testResult = { ok: true, message: 'Connected — pgvector is ready.' };
        } catch (e) {
            this._testResult = { ok: false, message: e?.body?.message || e?.message || 'Connection failed.' };
        } finally {
            this._testingConnection = false;
        }
    }

    async handleSaveBackend() {
        if (this._selectedBackend === 'external_pg' && !this._connectionUrlInput.trim() && !this._storageConfig.hasConnectionUrl) {
            this._testResult = { ok: false, message: 'Enter a Postgres connection string first.' };
            return;
        }
        this._savingBackend = true;
        try {
            const cfg = await saveStorageConfig({
                backend: this._selectedBackend,
                connectionUrl: this._connectionUrlInput.trim() || null
            });
            this._storageConfig = { ...this._storageConfig, ...cfg };
            this._connectionUrlInput = '';
            this._testResult = { ok: true, message: 'Storage backend saved.' };
        } catch (e) {
            this._testResult = { ok: false, message: e?.body?.message || e?.message || 'Could not save.' };
        } finally {
            this._savingBackend = false;
        }
    }

    handleNewTitleChange(e) { this._newDocTitle = e.target.value; }
    handleNewTextChange(e)  { this._newDocText = e.target.value; }

    get addDocumentDisabled() {
        return !(this._newDocTitle.trim().length > 0 && this._newDocText.trim().length > 0) || this._uploading;
    }

    async handleAddDocument() {
        this._uploading = true;
        this._uploadError = null;
        try {
            await uploadDocument({
                agentApiName: this.agentApiName,
                title: this._newDocTitle.trim(),
                text: this._newDocText,
                fileBase64: null
            });
            this._newDocTitle = '';
            this._newDocText = '';
            await this.loadDocuments();
        } catch (e) {
            this._uploadError = e?.body?.message || e?.message || 'Upload failed.';
        } finally {
            this._uploading = false;
        }
    }

    async handleReindexDocument(e) {
        const id = e.currentTarget.dataset.id;
        try {
            await reindexDocument({ documentId: id });
            await this.loadDocuments();
        } catch (e2) {
            this._docsError = e2?.body?.message || e2?.message || 'Reindex failed.';
        }
    }

    async handleDeleteDocument(e) {
        const id = e.currentTarget.dataset.id;
        try {
            await deleteDocument({ documentId: id });
            await this.loadDocuments();
        } catch (e2) {
            this._docsError = e2?.body?.message || e2?.message || 'Delete failed.';
        }
    }

    get documentRows() {
        const STATUS_CLASS = {
            Ready: 'kbm-badge kbm-badge--ready',
            Indexing: 'kbm-badge kbm-badge--indexing',
            Error: 'kbm-badge kbm-badge--error'
        };
        return this._documents.map(d => ({
            ...d,
            badgeClass: STATUS_CLASS[d.status] || 'kbm-badge',
            chunkLabel: d.chunkCount === 1 ? '1 chunk' : `${d.chunkCount} chunks`
        }));
    }
    get noDocuments() { return !this._docsLoading && !this._docsError && this._documents.length === 0; }
}
