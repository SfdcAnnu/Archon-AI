import { LightningElement, track, wire } from 'lwc';
import getExecutionLogs from '@salesforce/apex/AgentBuilderController.getExecutionLogs';
import getRunSteps      from '@salesforce/apex/AgentBuilderController.getRunSteps';

const PAGE_SIZE = 20;

export default class AgentExecutionLogs extends LightningElement {
    @track logs        = [];
    @track total       = 0;
    @track pageOffset  = 0;
    @track filterAgent = null;
    @track filterStatus= null;
    @track isLoading   = false;
    @track selectedLog = null;

    // ── Node-by-node trace (fetched on demand, not with the log list) ──
    @track traceState = 'idle'; // idle | loading | loaded | error | empty
    @track traceSteps = [];
    @track traceError = null;

    get showLoadTraceButton() { return this.traceState === 'idle'; }
    get traceLoading()  { return this.traceState === 'loading'; }
    get traceNotLoaded(){ return this.traceState === 'idle'; }
    get traceEmpty()     { return this.traceState === 'empty'; }

    async handleLoadTrace() {
        if (!this.selectedLog?.CorrelationId__c) return;
        this.traceState = 'loading';
        try {
            const result = await getRunSteps({ correlationId: this.selectedLog.CorrelationId__c });
            if (!result.steps || result.steps.length === 0) {
                this.traceState = 'empty';
                return;
            }
            this.traceSteps = result.steps.map((s, idx) => ({
                stepKey: `${s.nodeId}-${idx}`,
                displayLabel: s.nodeLabel || s.nodeId,
                nodeSubType: s.nodeSubType,
                inputJson: s.inputJson || '—',
                outputJson: s.outputJson || '—',
                errorMsg: s.errorMsg,
                statusDotClass: s.success ? 'trace-dot trace-dot--ok' : 'trace-dot trace-dot--err'
            }));
            this.traceState = 'loaded';
        } catch (err) {
            this.traceError = err?.body?.message || err?.message || 'Could not load node trace.';
            this.traceState = 'error';
        }
    }

    @wire(getExecutionLogs, {
        agentId:    '$filterAgent',
        pageSize:   PAGE_SIZE,
        pageOffset: '$pageOffset',
        status:     '$filterStatus'
    })
    wiredLogs({ data, error }) {
        if (data) {
            this.logs = data.records.map(r => {
                const isSuccess = r.Status__c === 'SUCCESS';
                const isError   = r.Status__c === 'ERROR' || r.Status__c === 'TIMEOUT';
                const isWaiting = r.Status__c === 'WAITING' || r.Status__c === 'WAITING_APPROVAL';
                const score     = r.AgentScore__c || 0;
                const scoreColor = score >= 80 ? '#2e844a'
                                 : score >= 50 ? '#ff9900' : '#c23934';
                const statusBadgeClass = isSuccess ? 'badge-ok'
                                       : isError   ? 'badge-err'
                                       : isWaiting ? 'badge-wait' : 'badge-run';
                return {
                    ...r,
                    agentName:   (r.AgentDefinition__r && r.AgentDefinition__r.Name) || '—',
                    department:  (r.AgentDefinition__r && r.AgentDefinition__r.Department__c) || '—',
                    isSuccess,
                    isError,
                    isWaiting,
                    statusClass: isSuccess ? 'status-ok' : isError ? 'status-err' : isWaiting ? 'status-wait' : 'status-run',
                    statusBadgeClass,
                    scoreColor,
                    scoreStyle:  `color:${scoreColor};font-weight:600`,
                    formattedDate: new Date(r.CreatedDate).toLocaleString()
                };
            });
            this.total = data.total;
        }
        if (error) console.error(error);
    }

    get hasLogs()     { return this.logs.length > 0; }
    get noLogs()      { return this.logs.length === 0; }
    get hasMore()     { return (this.pageOffset + PAGE_SIZE) < this.total; }
    get hasPrev()     { return this.pageOffset > 0; }
    get prevDisabled(){ return this.pageOffset === 0; }
    get nextDisabled(){ return (this.pageOffset + PAGE_SIZE) >= this.total; }
    get pageInfo()    { return `${this.pageOffset + 1}–${Math.min(this.pageOffset + PAGE_SIZE, this.total)} of ${this.total}`; }

    get statusOptions() {
        return [
            { label: 'All statuses',      value: '' },
            { label: 'Success',           value: 'SUCCESS' },
            { label: 'Error',             value: 'ERROR' },
            { label: 'Queued',            value: 'QUEUED' },
            { label: 'Running',           value: 'RUNNING' },
            { label: 'Waiting',           value: 'WAITING' },
            { label: 'Waiting approval',  value: 'WAITING_APPROVAL' },
            { label: 'Timeout',           value: 'TIMEOUT' }
        ];
    }

    handleFilterStatus(e) { this.filterStatus = e.detail.value || null; this.pageOffset = 0; }
    handleNextPage()   { this.pageOffset += PAGE_SIZE; }
    handlePrevPage()   { this.pageOffset = Math.max(0, this.pageOffset - PAGE_SIZE); }
    handleRowClick(e)  {
        this.selectedLog = this.logs.find(l => l.Id === e.currentTarget.dataset.id) || null;
        this.traceState = 'idle';
        this.traceSteps = [];
        this.traceError = null;
    }
    handleCloseDetail(){ this.selectedLog = null; }
    handleBack()       { this.dispatchEvent(new CustomEvent('back')); }

    /** Exports the CURRENT PAGE of visible rows — matches what the user is looking at. */
    handleExportCsv() {
        if (this.logs.length === 0) return;
        const columns = ['Agent', 'Department', 'Record ID', 'Score', 'Priority', 'Tools used', 'Status', 'Date', 'Correlation ID'];
        const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = this.logs.map(l => [
            l.agentName, l.department, l.RecordId__c, l.AgentScore__c, l.AgentPriority__c,
            l.ToolsUsed__c, l.Status__c, l.formattedDate, l.CorrelationId__c
        ].map(csvEscape).join(','));
        const csv = [columns.map(csvEscape).join(','), ...rows].join('\r\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `execution-logs-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}
