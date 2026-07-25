import { LightningElement, api, track } from 'lwc';
import getShares     from '@salesforce/apex/AgentSharingController.getShares';
import searchTargets from '@salesforce/apex/AgentSharingController.searchTargets';
import addShare      from '@salesforce/apex/AgentSharingController.addShare';
import removeShare   from '@salesforce/apex/AgentSharingController.removeShare';

const TYPE_META = {
    User:                 { icon: 'standard:user',          label: 'User' },
    Group:                { icon: 'standard:groups',        label: 'Public group' },
    Role:                 { icon: 'standard:hierarchy',     label: 'Role' },
    RoleAndSubordinates:  { icon: 'standard:hierarchy',     label: 'Role & subordinates' },
    Unknown:              { icon: 'standard:question_best', label: '' }
};

/**
 * Share panel for an agent. Admin searches users / public groups / roles
 * and grants Read access — Apex writes AgentDefinition__Share rows with
 * the ArchonAccess sharing reason. No Setup visit needed.
 */
export default class AgentShareModal extends LightningElement {
    @api agentId;
    @api agentName;

    @track shares = [];
    @track results = [];
    @track searchTerm = '';
    @track loading = true;
    @track searching = false;
    @track errorMessage = null;
    _searchTimer = null;

    connectedCallback() {
        this.refresh();
    }

    async refresh() {
        this.loading = true;
        this.errorMessage = null;
        try {
            const rows = await getShares({ agentId: this.agentId });
            this.shares = this.decorate(rows);
        } catch (e) {
            this.errorMessage = this.messageOf(e);
        } finally {
            this.loading = false;
        }
    }

    decorate(rows) {
        return (rows || []).map(r => ({
            ...r,
            icon: (TYPE_META[r.targetType] || TYPE_META.Unknown).icon,
            typeLabel: (TYPE_META[r.targetType] || TYPE_META.Unknown).label
        }));
    }

    get hasShares()  { return this.shares.length > 0; }
    get noShares()   { return !this.loading && this.shares.length === 0; }
    get hasResults() { return this.results.length > 0; }

    handleSearchChange(e) {
        this.searchTerm = e.target.value;
        clearTimeout(this._searchTimer);
        const term = this.searchTerm.trim();
        if (term.length < 2) { this.results = []; return; }
        this._searchTimer = setTimeout(() => this.runSearch(term), 300);
    }

    async runSearch(term) {
        this.searching = true;
        try {
            const found = await searchTargets({ term });
            // Hide targets that are already shared
            const sharedIds = new Set(this.shares.map(s => s.userOrGroupId));
            this.results = this.decorate(
                (found || []).filter(t => !sharedIds.has(t.id))
            );
        } catch (e) {
            this.errorMessage = this.messageOf(e);
        } finally {
            this.searching = false;
        }
    }

    async handleAdd(e) {
        const targetId = e.currentTarget.dataset.id;
        this.errorMessage = null;
        try {
            const rows = await addShare({ agentId: this.agentId, userOrGroupId: targetId });
            this.shares = this.decorate(rows);
            this.results = this.results.filter(r => r.id !== targetId);
        } catch (err) {
            this.errorMessage = this.messageOf(err);
        }
    }

    async handleRemove(e) {
        const shareId = e.currentTarget.dataset.id;
        this.errorMessage = null;
        try {
            const rows = await removeShare({ agentId: this.agentId, shareId });
            this.shares = this.decorate(rows);
        } catch (err) {
            this.errorMessage = this.messageOf(err);
        }
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    stop(e) {
        e.stopPropagation();
    }

    messageOf(e) {
        return e?.body?.message || e?.message || 'Something went wrong.';
    }
}
