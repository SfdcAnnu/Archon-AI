import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import listAccessibleForEngine from '@salesforce/apex/AiEngineConnectionController.listAccessibleForEngine';
import deleteConnection        from '@salesforce/apex/AiEngineConnectionController.deleteConnection';
import bindToNode              from '@salesforce/apex/AiEngineConnectionController.bindToNode';
import testConnection          from '@salesforce/apex/AiEngineConnectionController.testConnection';

/**
 * aiEngineConnectionPicker — enterprise-style credential selector.
 *
 * Three states:
 *   • Empty       — no credentials exist for this engine → prompt to add.
 *   • Prompt      — credentials exist but none bound → dropdown to pick.
 *   • Bound       — a credential is bound → compact card + Change / kebab menu.
 *
 * All actions (edit/test/delete/unbind) live behind a kebab menu on the
 * bound card so the narrow properties column never has to render more than
 * a single card + one row of small icons.
 */
export default class AiEngineConnectionPicker extends LightningElement {
    @api engineType;
    @api agentNodeId;
    @api selectedId;

    @track connections = [];
    @track loading = false;
    @track showForm = false;
    @track editRecordId = null;
    @track menuOpen = false;
    @track changeOpen = false;
    @track busyId = null;

    connectedCallback() { this.reload(); }

    // Reload when engine changes (parent updates the api)
    @api reload() {
        if (!this.engineType) return;
        this.loading = true;
        this.menuOpen = false;
        this.changeOpen = false;
        listAccessibleForEngine({ engineType: this.engineType })
            .then(rows => { this.connections = rows || []; })
            .catch(err => this.toastError('Could not load credentials', err))
            .finally(() => { this.loading = false; });
    }

    // ── Derived ────────────────────────────────────────────────

    get bound() {
        return this.connections.find(c => c.id === this.selectedId) || null;
    }
    get hasBound()         { return !!this.bound; }
    get showSelectPrompt() {
        return !this.loading && !this.bound && this.connections.length > 0 && !this.changeOpen;
    }
    get showEmpty() {
        return !this.loading && !this.bound && this.connections.length === 0;
    }

    // ── State classification for the banner rail + tone ───

    /**
     * One of:
     *   'unconfigured'   → no credentials exist for this engine (red rail, action tone)
     *   'needs-select'   → credentials exist but nothing bound (blue rail)
     *   'failed'         → bound but last test failed (red rail, warning)
     *   'untested'       → bound but never tested (amber rail, gentle nudge)
     *   'ready'          → bound + validated (green rail, confident)
     */
    get pickerState() {
        if (this.loading)     return 'ready';                     // avoid jitter
        if (!this.bound && this.connections.length === 0) return 'unconfigured';
        if (!this.bound)      return 'needs-select';
        const s = this.bound.validationStatus;
        if (s === 'Failed')   return 'failed';
        if (s === 'Success')  return 'ready';
        return 'untested';
    }
    get pickerStateClass() { return `picker picker-${this.pickerState}`; }

    get stateIcon() {
        switch (this.pickerState) {
            case 'unconfigured': return 'utility:warning';
            case 'needs-select': return 'utility:target';
            case 'failed':       return 'utility:error';
            case 'untested':     return 'utility:info';
            default:             return 'utility:success';
        }
    }
    get stateTitle() {
        switch (this.pickerState) {
            case 'unconfigured': return 'API key required';
            case 'needs-select': return 'Choose an API key';
            case 'failed':       return 'Last test failed';
            case 'untested':     return 'Not yet tested';
            default:             return 'Ready to run';
        }
    }
    get stateSub() {
        switch (this.pickerState) {
            case 'unconfigured': return `Add a ${this.engineDisplay} key to activate this node.`;
            case 'needs-select': return 'Select which credential this node runs with.';
            case 'failed':       return 'Provider rejected the key. Update it and test again.';
            case 'untested':     return 'Run Test connection to verify the key is valid.';
            default:             return 'Bound and validated.';
        }
    }

    // Bound-card derived state
    get boundLabel()      { return this.bound?.label || ''; }
    get boundOwnership()  { return this.bound?.ownershipType || ''; }
    get boundModel()      { return this.bound?.defaultModel || ''; }
    get boundIsMine()     { return this.bound?.isMine === true; }
    get boundBadgeClass() {
        return this.bound?.ownershipType === 'Shared'
            ? 'badge badge-shared'
            : 'badge badge-personal';
    }
    get boundStatusDotClass() {
        const s = this.bound?.validationStatus;
        return s === 'Success' ? 'status-dot status-ok'
             : s === 'Failed'  ? 'status-dot status-fail'
             :                   'status-dot status-untested';
    }
    get boundStatusTitle() {
        const s = this.bound?.validationStatus;
        if (s === 'Success') return 'Validated';
        if (s === 'Failed')  return 'Last test failed';
        return 'Not yet tested';
    }

    // Change-popover options
    get changeOptions() {
        return this.connections.map(c => ({
            ...c,
            rowClass:  c.id === this.selectedId ? 'opt-row opt-row--current' : 'opt-row',
            dotClass:
                c.validationStatus === 'Success' ? 'status-dot status-ok'
              : c.validationStatus === 'Failed'  ? 'status-dot status-fail'
              :                                    'status-dot status-untested',
            badgeClass: c.ownershipType === 'Shared'
                ? 'badge badge-shared'
                : 'badge badge-personal'
        }));
    }

    // Combobox options (used when nothing bound + we want a prompt)
    get comboOptions() {
        return this.connections.map(c => ({
            label: `${c.label}  ·  ${c.ownershipType}${c.defaultModel ? ' · ' + c.defaultModel : ''}`,
            value: c.id
        }));
    }

    get engineDisplay() {
        switch (this.engineType) {
            case 'claude': return 'Claude';
            case 'openai': return 'OpenAI';
            case 'gemini': return 'Gemini';
            case 'custom': return 'Custom';
            default: return this.engineType;
        }
    }

    // ── Actions ────────────────────────────────────────────────

    handleAddNew() {
        this.editRecordId = null;
        this.showForm = true;
    }

    handleChange() {
        this.changeOpen = true;
        this.menuOpen = false;
    }

    handleCloseChange() {
        this.changeOpen = false;
    }

    async handleSwitchTo(event) {
        const id = event.currentTarget.dataset.id;
        this.changeOpen = false;
        if (id === this.selectedId) return;
        await this.bindConnection(id);
    }

    handleComboChange(event) {
        const id = event.detail.value;
        this.bindConnection(id);
    }

    handleToggleMenu() {
        this.menuOpen = !this.menuOpen;
    }

    async handleMenuClick(event) {
        const btn = event.target.closest('button');
        if (!btn) return;
        const action = btn.dataset.action;
        this.menuOpen = false;
        if (action === 'test')   return this.testCurrent();
        if (action === 'edit')   return this.editCurrent();
        if (action === 'delete') return this.deleteCurrent();
        if (action === 'unbind') return this.unbindCurrent();
    }

    // ── Internal helpers ───────────────────────────────────────

    async bindConnection(id) {
        try {
            this.busyId = id;
            if (this.agentNodeId) await bindToNode({ agentNodeId: this.agentNodeId, connectionId: id });
            this.selectedId = id;
            const conn = this.connections.find(c => c.id === id);
            this.dispatchEvent(new CustomEvent('configchange', {
                detail: { connectionId: id, connection: conn }
            }));
            this.toast('Selected', `${conn?.label || 'Credential'} bound to this node.`, 'success');
        } catch (err) {
            this.toastError('Could not bind credential', err);
        } finally {
            this.busyId = null;
        }
    }

    async testCurrent() {
        const id = this.selectedId;
        if (!id) return;
        try {
            this.busyId = id;
            const res = await testConnection({ recordId: id });
            this.toast(
                res.success ? 'Test passed' : 'Test failed',
                res.message,
                res.success ? 'success' : 'error'
            );
            this.reload();
        } catch (err) {
            this.toastError('Test error', err);
        } finally {
            this.busyId = null;
        }
    }

    editCurrent() {
        this.editRecordId = this.selectedId;
        this.showForm = true;
    }

    async deleteCurrent() {
        const b = this.bound;
        if (!b) return;
        if (!confirm(`Delete "${b.label}"? This can't be undone.`)) return;
        try {
            this.busyId = b.id;
            await deleteConnection({ recordId: b.id });
            this.selectedId = null;
            this.dispatchEvent(new CustomEvent('configchange', {
                detail: { connectionId: null, connection: null }
            }));
            this.toast('Deleted', `${b.label} removed.`, 'success');
            this.reload();
        } catch (err) {
            this.toastError('Could not delete', err);
        } finally {
            this.busyId = null;
        }
    }

    async unbindCurrent() {
        if (!this.agentNodeId) return;
        try {
            await bindToNode({ agentNodeId: this.agentNodeId, connectionId: null });
            this.selectedId = null;
            this.dispatchEvent(new CustomEvent('configchange', {
                detail: { connectionId: null, connection: null }
            }));
            this.toast('Unbound', 'Node will resolve credentials at runtime.', 'info');
        } catch (err) {
            this.toastError('Could not unbind', err);
        }
    }

    handleFormSaved(event) {
        const savedId = event.detail?.recordId;
        this.showForm = false;
        this.editRecordId = null;
        if (savedId && !this.selectedId && this.agentNodeId) {
            this.bindConnection(savedId).finally(() => this.reload());
        } else {
            this.reload();
        }
    }

    handleFormCancel() {
        this.showForm = false;
        this.editRecordId = null;
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant: variant || 'info' }));
    }
    toastError(title, err) {
        const msg = err?.body?.message || err?.message || 'Unknown error';
        this.toast(title, msg, 'error');
    }
}
