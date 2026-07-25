import { LightningElement, track } from 'lwc';
import getMyPendingApprovals from '@salesforce/apex/AgentApprovalController.getMyPendingApprovals';
import decide from '@salesforce/apex/AgentApprovalController.decide';

/** My Approvals — pending Agent Approval nodes assigned to the current user. */
export default class AgentApprovalList extends LightningElement {
    @track _rows = [];
    @track loading = true;
    @track errorMessage = null;

    @track _openCommentId = null;
    @track _comment = '';
    @track _deciding = false;

    connectedCallback() {
        this.load();
    }

    async load() {
        this.loading = true;
        this.errorMessage = null;
        try {
            const rows = await getMyPendingApprovals();
            this._rows = rows.map((r) => ({
                ...r,
                timeoutLabel: r.timeoutAt ? new Date(r.timeoutAt).toLocaleString() : null,
                createdLabel: new Date(r.createdDate).toLocaleString(),
            }));
        } catch (e) {
            this.errorMessage = e?.body?.message || e?.message || 'Could not load approvals.';
        } finally {
            this.loading = false;
        }
    }

    get rows() {
        return this._rows.map((r) => ({
            ...r,
            showComment: this._openCommentId === r.id,
        }));
    }
    get noApprovals() { return !this.loading && !this.errorMessage && this._rows.length === 0; }

    handleToggleComment(e) {
        const id = e.currentTarget.dataset.id;
        this._openCommentId = this._openCommentId === id ? null : id;
        this._comment = '';
    }
    handleCommentChange(e) { this._comment = e.target.value; }

    async handleApprove(e)  { await this.decideRow(e.currentTarget.dataset.id, 'approved'); }
    async handleReject(e)   { await this.decideRow(e.currentTarget.dataset.id, 'rejected'); }

    async decideRow(id, decision) {
        this._deciding = true;
        try {
            await decide({ approvalId: id, decision, comments: this._comment || null });
            this._rows = this._rows.filter((r) => r.id !== id);
            this._openCommentId = null;
            this._comment = '';
        } catch (e) {
            this.errorMessage = e?.body?.message || e?.message || 'Could not record your decision.';
        } finally {
            this._deciding = false;
        }
    }

    handleRefresh() { this.load(); }
}
