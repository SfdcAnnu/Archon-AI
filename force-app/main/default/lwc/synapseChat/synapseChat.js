import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import listAgents     from '@salesforce/apex/AgentChatController.listChatEnabledAgents';
import listSessions   from '@salesforce/apex/AgentChatController.listMySessions';
import startSession   from '@salesforce/apex/AgentChatController.startSession';

/**
 * synapseChat — standalone tab.
 *
 * Three columns visually:
 *   • Left rail — recent sessions + agent picker
 *   • Right — synapseChatPanel for the selected session
 *
 * Starts with no active session. User picks an agent from "+ New chat" or
 * clicks a recent session in the sidebar.
 */
export default class SynapseChat extends LightningElement {
    @track agents = [];
    @track sessions = [];
    @track activeSessionId = null;
    @track activeAgentApiName = null;
    @track showPicker = false;
    @track agentFilter = '';
    @track loadingAgents = false;
    @track loadingSessions = false;

    connectedCallback() {
        this.refreshSessions();
    }

    async refreshSessions() {
        this.loadingSessions = true;
        try {
            this.sessions = await listSessions({ limitN: 30 });
        } catch (err) {
            this.toastError('Could not load sessions', err);
        } finally {
            this.loadingSessions = false;
        }
    }

    async openAgentPicker() {
        this.showPicker = true;
        this.loadingAgents = true;
        try {
            this.agents = await listAgents({ filter: this.agentFilter });
        } catch (err) {
            this.toastError('Could not load agents', err);
        } finally {
            this.loadingAgents = false;
        }
    }

    handleFilterChange(e) {
        this.agentFilter = e.target.value;
        // Debounce-light: just refire
        clearTimeout(this._t);
        this._t = setTimeout(async () => {
            try { this.agents = await listAgents({ filter: this.agentFilter }); }
            catch (err) { this.toastError('Could not search agents', err); }
        }, 200);
    }

    closePicker() { this.showPicker = false; }

    async handlePickAgent(e) {
        const apiName = e.currentTarget.dataset.apiname;
        if (!apiName) return;
        this.showPicker = false;
        try {
            const result = await startSession({
                agentApiName: apiName,
                recordContextId: null,
                recordContextType: null
            });
            this.activeAgentApiName = apiName;
            this.activeSessionId    = result.session.Id;
            await this.refreshSessions();
        } catch (err) {
            this.toastError('Could not start chat', err);
        }
    }

    handlePickSession(e) {
        const id = e.currentTarget.dataset.id;
        const apiName = e.currentTarget.dataset.apiname;
        if (!id || !apiName) return;
        this.activeSessionId    = id;
        this.activeAgentApiName = apiName;
    }

    handleSessionChange(e) {
        // synapseChatPanel emits this on end AND after each successful turn so
        // the sidebar refreshes titles/totals (auto-title fills in ~5s later).
        if (e.detail?.ended) {
            this.activeSessionId    = null;
            this.activeAgentApiName = null;
            this.refreshSessions();
            return;
        }
        if (e.detail?.turnCompleted) {
            this.refreshSessions();
        }
    }

    // ── Derived ─────────────────────────────────────────────────

    get sessionItems() {
        return this.sessions.map(s => ({
            ...s,
            cssClass: s.id === this.activeSessionId ? 'sess sess-active' : 'sess',
            subtitle: this.formatSubtitle(s)
        }));
    }

    formatSubtitle(s) {
        const status = s.status === 'Active' ? '' : ` · ${s.status}`;
        const turns = s.totalTurns ? ` · ${s.totalTurns} turns` : '';
        return `${s.agentName || s.agentApiName}${turns}${status}`;
    }

    get hasActiveSession() { return !!this.activeSessionId; }
    get hasSessions()      { return this.sessions.length > 0; }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant: variant || 'info' }));
    }
    toastError(title, err) {
        const msg = err?.body?.message || err?.message || 'Unknown error';
        this.toast(title, msg, 'error');
    }
}
