import { LightningElement, track, wire } from 'lwc';
import getExecutionLogs from '@salesforce/apex/AgentBuilderController.getExecutionLogs';

const PAGE_SIZE = 20;

export default class AgentExecutionLogs extends LightningElement {
    @track logs        = [];
    @track total       = 0;
    @track pageOffset  = 0;
    @track filterAgent = null;
    @track filterStatus= null;
    @track isLoading   = false;
    @track selectedLog = null;

    @wire(getExecutionLogs, {
        agentId:    '$filterAgent',
        pageSize:   PAGE_SIZE,
        pageOffset: '$pageOffset'
    })
    wiredLogs({ data, error }) {
        if (data) {
            this.logs = data.records.map(r => {
                const isSuccess = r.Status__c === 'SUCCESS';
                const isError   = r.Status__c === 'ERROR';
                const score     = r.AgentScore__c || 0;
                const scoreColor = score >= 80 ? '#2e844a'
                                 : score >= 50 ? '#ff9900' : '#c23934';
                const statusBadgeClass = isSuccess ? 'badge-ok'
                                       : isError   ? 'badge-err' : 'badge-run';
                return {
                    ...r,
                    agentName:   (r.AgentDefinition__r && r.AgentDefinition__r.Name) || '—',
                    department:  (r.AgentDefinition__r && r.AgentDefinition__r.Department__c) || '—',
                    isSuccess,
                    isError,
                    statusClass: isSuccess ? 'status-ok' : isError ? 'status-err' : 'status-run',
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
            { label: 'All statuses', value: '' },
            { label: 'Success',      value: 'SUCCESS' },
            { label: 'Error',        value: 'ERROR' },
            { label: 'Running',      value: 'RUNNING' }
        ];
    }

    handleFilterStatus(e) { this.filterStatus = e.detail.value || null; this.pageOffset = 0; }
    handleNextPage()   { this.pageOffset += PAGE_SIZE; }
    handlePrevPage()   { this.pageOffset = Math.max(0, this.pageOffset - PAGE_SIZE); }
    handleRowClick(e)  { this.selectedLog = this.logs.find(l => l.Id === e.currentTarget.dataset.id) || null; }
    handleCloseDetail(){ this.selectedLog = null; }
    handleBack()       { this.dispatchEvent(new CustomEvent('back')); }
}
