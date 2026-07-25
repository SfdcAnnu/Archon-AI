import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import saveConnection from '@salesforce/apex/AiEngineConnectionController.saveConnection';

/**
 * aiEngineConnectionForm — modal to create or edit an AiEngineConnection__c.
 */
export default class AiEngineConnectionForm extends LightningElement {
    @api engineType;               // read from parent (context)
    @api recordId;
    /**
     * Existing connection summary to pre-populate when editing — the API
     * key itself is never sent back to the client, so that field stays
     * blank (see apiKeyPlaceholder) and is left alone on save unless typed.
     */
    @api
    set existing(v) {
        if (!v) return;
        this.label          = v.label ?? '';
        this.endpoint        = v.endpoint ?? '';
        this.defaultModel    = v.defaultModel ?? '';
        this.isActive        = v.isActive !== false;
        this.isPreferred     = v.isPreferred === true;
        this.ownershipType   = v.ownershipType || 'Personal';
        this.isPublicShared  = v.isPublicShared === true;
        this.engineTypeOverride = v.engineType || null;
    }
    get existing() { return null; }

    @track engineTypeOverride = null;   // user's combobox pick, wins over @api
    @track label = '';
    @track apiKey = '';
    @track endpoint = '';
    @track defaultModel = '';
    @track isActive = true;
    @track isPreferred = false;
    @track ownershipType = 'Personal';
    @track isPublicShared = false;
    @track notes = '';
    @track saving = false;

    /** The effective engine type — user's pick, else the parent's context. */
    get currentEngine() {
        return this.engineTypeOverride || this.engineType || null;
    }

    get isEdit() { return !!this.recordId; }
    get title()  { return this.isEdit ? 'Edit Connection' : 'New Connection'; }
    get ownershipOptions() {
        return [
            { label: 'Personal — only I can use this key', value: 'Personal' },
            { label: 'Shared — admin-managed, sharable with others', value: 'Shared' }
        ];
    }
    get engineOptions() {
        return [
            { label: 'Claude (Anthropic)',   value: 'claude' },
            { label: 'OpenAI (GPT)',         value: 'openai' },
            { label: 'Google Gemini',        value: 'gemini' },
            { label: 'Custom / Self-hosted', value: 'custom' }
        ];
    }
    get isShared() { return this.ownershipType === 'Shared'; }
    get apiKeyPlaceholder() {
        return this.isEdit ? 'Leave blank to keep existing' : 'Paste your API key';
    }
    get engineDisplay() {
        switch (this.currentEngine) {
            case 'claude': return 'Claude (Anthropic)';
            case 'openai': return 'OpenAI (GPT)';
            case 'gemini': return 'Google Gemini';
            case 'custom': return 'Custom / Self-hosted';
            default: return 'Select an engine';
        }
    }

    handleFieldChange(event) {
        const f = event.target.dataset.field;
        const val = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
        if (f === 'engineType') {
            this.engineTypeOverride = val;
            return;
        }
        this[f] = val;
    }

    async handleSave() {
        const engineToSave = this.currentEngine;
        // Diagnostic: help pin down where engine type gets lost.
        // eslint-disable-next-line no-console
        console.log('[EngineForm] save clicked. engineType=', this.engineType,
                    'engineTypeOverride=', this.engineTypeOverride,
                    'currentEngine=', engineToSave);
        if (!engineToSave) {
            this.toast('Missing engine', 'Choose which AI engine this key belongs to.', 'warning');
            return;
        }
        if (!this.label || !this.label.trim()) {
            this.toast('Missing name', 'Give the connection a label so you can find it later.', 'warning');
            return;
        }
        if (!this.isEdit && (!this.apiKey || !this.apiKey.trim())) {
            this.toast('Missing key', 'Paste the API key from your provider.', 'warning');
            return;
        }
        this.saving = true;
        try {
            const savedId = await saveConnection({
                recordId:       this.recordId || null,
                engineType:     engineToSave,
                ownershipType:  this.ownershipType,
                labelText:      this.label,
                apiKey:         this.apiKey || null,
                endpoint:       this.endpoint || null,
                defaultModel:   this.defaultModel || null,
                isActive:       this.isActive === true,
                isPreferred:    this.isPreferred === true,
                isPublicShared: this.isPublicShared === true,
                notes:          this.notes || null
            });
            this.toast('Saved', 'Connection saved. Test it before using in production.', 'success');
            this.dispatchEvent(new CustomEvent('saved', { detail: { recordId: savedId } }));
        } catch (err) {
            const msg = err?.body?.message || err?.message || 'Save failed';
            this.toast('Save failed', msg, 'error');
        } finally {
            this.saving = false;
        }
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('cancel'));
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
