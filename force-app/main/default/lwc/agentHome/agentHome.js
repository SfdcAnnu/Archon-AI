import { LightningElement, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getAgentDefinitions from '@salesforce/apex/AgentBuilderController.getAgentDefinitions';
import getDepartmentStats  from '@salesforce/apex/AgentBuilderController.getDepartmentStats';
import updateAgentStatus   from '@salesforce/apex/AgentBuilderController.updateAgentStatus';
import deleteAgent         from '@salesforce/apex/AgentBuilderController.deleteAgent';

const DEPT_COLORS = {
    Sales: '#0176d3', Service: '#2e844a', Marketing: '#ea4335',
    Finance: '#7c4dff', HR: '#c36a13', Operations: '#5c6bc0'
};

export default class AgentHome extends NavigationMixin(LightningElement) {
    @track agents         = [];
    @track deptStats      = [];
    @track selectedDept   = null;
    @track selectedAgent  = null;
    @track activeView     = 'home';   // home | builder | testrunner | logs
    @track isLoading      = false;
    @track showNewModal   = false;

    // ── Wire: load agents reactively on dept change ─────────────────
    @wire(getAgentDefinitions, { department: '$selectedDept' })
    wiredAgents({ data, error }) {
        if (data) {
            this.agents = data.map(a => {
                const border = DEPT_COLORS[a.Department__c] || '#dddbda';
                return {
                    ...a,
                    statusBadgeClass: a.Status__c === 'Active' ? 'badge-active' : 'badge-draft',
                    borderColor: border,
                    cardStyle: `border-top: 3px solid ${border}`,
                    dotColor: a.Status__c === 'Active' ? '#2e844a'
                            : a.Status__c === 'Draft'  ? '#ff9900' : '#dddbda'
                };
            });
        }
        if (error) this.showError(error);
    }

    @wire(getDepartmentStats)
    wiredDeptStats({ data, error }) {
        if (data) {
            this.deptStats = data.map(d => {
                const color = DEPT_COLORS[d.department] || '#706e6b';
                return {
                    ...d,
                    color,
                    dotStyle: `background:${color}`,
                    rowClass: d.department === this.selectedDept ? 'dept-group selected' : 'dept-group'
                };
            });
        }
        if (error) this.showError(error);
    }

    // ── Computed ─────────────────────────────────────────────────────
    get totalAgents()     { return this.agents.length; }
    get activeAgents()    { return this.agents.filter(a => a.Status__c === 'Active').length; }
    get totalRuns()       { return this.deptStats.reduce((s, d) => s + (d.totalRuns || 0), 0); }
    get showHome()        { return this.activeView === 'home'; }
    get showBuilder()     { return this.activeView === 'builder'; }
    get showTestRunner()  { return this.activeView === 'testrunner'; }
    get showLogs()        { return this.activeView === 'logs'; }
    get homeTabClass()    { return this.activeView === 'home' ? 'sub-tab active' : 'sub-tab'; }
    get logsTabClass()    { return this.activeView === 'logs' ? 'sub-tab active' : 'sub-tab'; }
    get selectedAgentId() { return (this.selectedAgent && this.selectedAgent.Id) || null; }

    get deptMenuItems() {
        const depts = [...new Set(this.agents.map(a => a.Department__c))].sort();
        return [
            { label: 'All Departments', value: null },
            ...depts.map(d => ({ label: d, value: d }))
        ];
    }

    // ── Handlers ─────────────────────────────────────────────────────
    handleDeptSelect(e) {
        const clicked = e.currentTarget.dataset.dept;
        // Toggle off if same dept clicked again
        this.selectedDept = (this.selectedDept === clicked) ? null : clicked;
    }

    handleClearDept() {
        this.selectedDept = null;
    }

    handleAgentClick(e) {
        const agentId = e.currentTarget.dataset.id;
        this.selectedAgent = this.agents.find(a => a.Id === agentId);
        this.activeView = 'builder';
    }

    handleNewAgent() {
        this.selectedAgent = null;
        this.activeView = 'builder';
    }

    handleViewLogs() {
        this.activeView = 'logs';
    }

    handleBuilderBack() {
        this.activeView = 'home';
        this.selectedAgent = null;
    }

    handleTestRunner(e) {
        this.selectedAgent = e.detail;
        this.activeView = 'testrunner';
    }

    handleTestRunnerBack() {
        this.activeView = this.selectedAgent ? 'builder' : 'home';
    }

    handleNavHome() { this.activeView = 'home'; }
    stopProp(e)     { e.stopPropagation(); }

    async handleToggleStatus(e) {
        e.stopPropagation();
        const agentId = e.currentTarget.dataset.id;
        const agent   = this.agents.find(a => a.Id === agentId);
        const newStatus = agent.Status__c === 'Active' ? 'Inactive' : 'Active';
        try {
            await updateAgentStatus({ agentId, status: newStatus });
            this.showToast('success', `Agent ${newStatus.toLowerCase()}`);
        } catch (err) {
            this.showError(err);
        }
    }

    async handleDeleteAgent(e) {
        e.stopPropagation();
        const agentId = e.currentTarget.dataset.id;
        // eslint-disable-next-line no-alert
        if (!confirm('Delete this agent and all its nodes?')) return;
        try {
            await deleteAgent({ agentId });
            this.showToast('success', 'Agent deleted');
        } catch (err) {
            this.showError(err);
        }
    }

    // ── Utils ────────────────────────────────────────────────────────
    showToast(variant, message) {
        this.dispatchEvent(new ShowToastEvent({ title: message, variant }));
    }

    showError(err) {
        const msg = err?.body?.message || err?.message || 'Unknown error';
        this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
    }
}
