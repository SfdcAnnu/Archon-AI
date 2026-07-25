import { LightningElement, api, track } from 'lwc';
import getCustomActionCatalog from '@salesforce/apex/AgentConnectorController.getCustomActionCatalog';
import describeCustomAction   from '@salesforce/apex/AgentConnectorController.describeCustomAction';

const TYPE_LABEL = { apex: 'Apex action', flow: 'Flow' };
const TYPE_ICON  = { apex: 'utility:apex', flow: 'utility:flow' };

/**
 * "Add Tools"-style picker for the org's own automation: invocable Apex
 * actions + autolaunched Flows, listed live from the org with the input
 * schema shown before adding. Selecting one dispatches `addtool`
 * ({ type, name, label }) — the node's config stores the selection and
 * the MCP server registers the tool dynamically at runtime.
 */
export default class AgentCustomToolPicker extends LightningElement {
    /** Already-selected tools (to hide from the list): [{type,name}] */
    @api selected = [];

    @track items = [];          // full catalog [{type,name,label}]
    @track filter = '';
    @track typeFilter = 'all';
    @track loading = true;
    @track errorMessage = null;

    @track detail = null;       // { type,name,label,description,inputRows }
    @track detailLoading = false;
    _detailKey = null;

    connectedCallback() {
        this.loadCatalog();
    }

    _wakeRetries = 0;
    async loadCatalog() {
        this.loading = true;
        this.errorMessage = null;
        try {
            const raw = await getCustomActionCatalog();
            const parsed = JSON.parse(raw);
            this.items = (parsed.actions || []).map(a => ({
                ...a,
                key: `${a.type}:${a.name}`,
                typeLabel: TYPE_LABEL[a.type] || a.type,
                icon: TYPE_ICON[a.type] || 'utility:apps'
            }));
            this._wakeRetries = 0;
            this.loading = false;
        } catch (e) {
            const msg = e?.body?.message || e?.message || '';
            // Waking free-tier server → keep the spinner up and retry
            // quietly instead of showing a scary error.
            if (/SERVER_WAKING|Application loading|502|503|unreachable/i.test(msg) && this._wakeRetries < 12) {
                this._wakeRetries++;
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                setTimeout(() => this.loadCatalog(), 9000);
                return;   // loading stays true
            }
            this.errorMessage = msg || 'Could not load the org catalog.';
            this.loading = false;
        }
    }

    get typeOptions() {
        return [
            { label: 'All types',    value: 'all' },
            { label: 'Apex actions', value: 'apex' },
            { label: 'Flows',        value: 'flow' }
        ];
    }

    get visibleItems() {
        const selectedKeys = new Set((this.selected || []).map(s => `${s.type}:${s.name}`));
        const f = this.filter.trim().toLowerCase();
        return this.items
            .filter(i => !selectedKeys.has(i.key))
            .filter(i => this.typeFilter === 'all' || i.type === this.typeFilter)
            .filter(i => !f || i.label.toLowerCase().includes(f) || i.name.toLowerCase().includes(f))
            .map(i => ({
                ...i,
                rowClass: this._detailKey === i.key ? 'ctp-item ctp-item--active' : 'ctp-item'
            }));
    }

    get noItems() { return !this.loading && this.visibleItems.length === 0; }
    get itemCountLabel() {
        return `${this.items.length} actions available`;
    }

    handleFilterChange(e)  { this.filter = e.target.value; }
    handleTypeChange(e)    { this.typeFilter = e.detail.value; }

    async handlePickItem(e) {
        const key = e.currentTarget.dataset.key;
        const item = this.items.find(i => i.key === key);
        if (!item) return;
        this._detailKey = key;
        this.detailLoading = true;
        this.detail = { ...item, inputRows: [] };
        try {
            const raw = await describeCustomAction({ actionType: item.type, name: item.name });
            const d = JSON.parse(raw);
            this.detail = {
                ...item,
                label: d.label || item.label,
                description: d.description || null,
                inputRows: (d.inputs || []).map((inp, idx) => ({
                    id: idx,
                    name: inp.name,
                    type: inp.type || 'string',
                    required: inp.required === true ? 'required' : 'optional',
                    description: inp.description || inp.label || ''
                }))
            };
        } catch (err) {
            this.detail = { ...item, description: null, inputRows: [],
                loadError: err?.body?.message || err?.message || 'Could not load the schema.' };
        } finally {
            this.detailLoading = false;
        }
    }

    handleAddTool() {
        if (!this.detail) return;
        this.dispatchEvent(new CustomEvent('addtool', {
            detail: { type: this.detail.type, name: this.detail.name, label: this.detail.label }
        }));
        // Keep the modal open so several tools can be added in one visit;
        // clear the preview since that item leaves the list.
        this.detail = null;
        this._detailKey = null;
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    stop(e) { e.stopPropagation(); }
}
