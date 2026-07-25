import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getStatus     from '@salesforce/apex/SynapseSetupController.getStatus';
import refreshStatus from '@salesforce/apex/SynapseSetupController.refreshStatus';
import startSetup    from '@salesforce/apex/SynapseSetupController.startSetup';
import resetSetup    from '@salesforce/apex/SynapseSetupController.resetSetup';
import listAccessibleForEngine from '@salesforce/apex/AiEngineConnectionController.listAccessibleForEngine';
import deleteConnection         from '@salesforce/apex/AiEngineConnectionController.deleteConnection';
import testConnectionApex       from '@salesforce/apex/AiEngineConnectionController.testConnection';

const ENGINES = [
    { value: 'claude', label: 'Claude (Anthropic)' },
    { value: 'openai', label: 'OpenAI (GPT)' },
    { value: 'gemini', label: 'Google Gemini' },
    { value: 'custom', label: 'Custom / Self-hosted' }
];

export default class SynapseSetup extends LightningElement {
    @track status = null;
    @track loading = false;
    @track authorizing = false;

    @track activeTab = 'salesforce';
    get isSalesforceTab() { return this.activeTab === 'salesforce'; }
    get isAiTab()          { return this.activeTab === 'ai'; }
    get salesforceTabClass() { return this.isSalesforceTab ? 'setup-tab setup-tab--on' : 'setup-tab'; }
    get aiTabClass()          { return this.isAiTab ? 'setup-tab setup-tab--on' : 'setup-tab'; }
    handleTabSalesforce() { this.activeTab = 'salesforce'; }
    handleTabAi() {
        this.activeTab = 'ai';
        if (!this._connectionsLoaded) this.loadConnections();
    }

    // ── AI Provider Setup ────────────────────────────────────────
    @track _connections = [];
    @track connectionsLoading = false;
    @track showConnectionForm = false;
    @track editingConnectionId = null;
    @track editingConnectionSummary = null;
    _connectionsLoaded = false;

    async loadConnections() {
        this.connectionsLoading = true;
        try {
            const results = await Promise.all(
                ENGINES.map(e => listAccessibleForEngine({ engineType: e.value }))
            );
            this._connections = results.flat();
            this._connectionsLoaded = true;
        } catch (err) {
            this.toastError('Could not load AI Engine Connections', err);
        } finally {
            this.connectionsLoading = false;
        }
    }

    get noConnections() { return !this.connectionsLoading && this._connections.length === 0; }

    get connectionRows() {
        const ENGINE_LABEL = { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini', custom: 'Custom' };
        const ENGINE_CLASS = { claude: 'chip-engine chip-engine--claude', openai: 'chip-engine chip-engine--openai',
                                gemini: 'chip-engine chip-engine--gemini', custom: 'chip-engine chip-engine--custom' };
        return this._connections.map(c => ({
            ...c,
            engineLabel: ENGINE_LABEL[c.engineType] || c.engineType,
            engineBadgeClass: ENGINE_CLASS[c.engineType] || 'chip-engine',
            isShared: c.ownershipType === 'Shared',
            isMine: c.isMine === true,
            isInactive: c.isActive === false,
            validationLabel: c.validationStatus || 'Untested',
            validationClass: c.validationStatus === 'Valid' ? 'val-ok'
                            : c.validationStatus === 'Invalid' ? 'val-err' : 'val-unk',
            testing: false
        }));
    }

    handleAddConnection() {
        this.editingConnectionId = null;
        this.editingConnectionSummary = null;
        this.showConnectionForm = true;
    }
    handleEditConnection(e) {
        const id = e.currentTarget.dataset.id;
        this.editingConnectionId = id;
        this.editingConnectionSummary = this._connections.find(c => c.id === id) || null;
        this.showConnectionForm = true;
    }
    handleConnectionFormCancel() { this.showConnectionForm = false; }
    async handleConnectionSaved() {
        this.showConnectionForm = false;
        await this.loadConnections();
    }

    async handleDeleteConnection(e) {
        const id = e.currentTarget.dataset.id;
        // eslint-disable-next-line no-alert
        if (!window.confirm('Delete this AI Engine Connection? Any agent nodes bound to it will need a new one.')) return;
        try {
            await deleteConnection({ recordId: id });
            this.toast('Deleted', 'Connection removed.', 'success');
            await this.loadConnections();
        } catch (err) {
            this.toastError('Delete failed', err);
        }
    }

    async handleTestConnection(e) {
        const id = e.currentTarget.dataset.id;
        try {
            const result = await testConnectionApex({ recordId: id });
            this.toast(result.success ? 'Connection OK' : 'Connection failed', result.message, result.success ? 'success' : 'error');
            await this.loadConnections();
        } catch (err) {
            this.toastError('Test failed', err);
        }
    }

    connectedCallback() {
        console.log('[SynapseSetup] connectedCallback fired. URL =', window.location.href);
        this.bootstrap();
    }

    async bootstrap() {
        const params = new URLSearchParams(window.location.search);
        const urlSaysComplete = params.get('synapse_setup') === '1';
        const urlSaysFailed   = params.get('synapse_setup') === '0';
        console.log('[SynapseSetup] bootstrap. urlSaysComplete=', urlSaysComplete, 'urlSaysFailed=', urlSaysFailed);

        if (urlSaysFailed) {
            this.toastError('Setup failed', { body: { message: params.get('error') || 'Unknown error' } });
            this.cleanUrlBar();
            await this.loadStatus();
            return;
        }

        // Always call refreshStatus on first load — it's authoritative (hits the
        // server), inexpensive, and avoids any cache-staleness on getStatus.
        this.cleanUrlBar();
        await this.refreshFromServer(urlSaysComplete);
    }

    async loadStatus() {
        this.loading = true;
        try { this.status = await getStatus(); }
        catch (err) { this.toastError('Could not load setup status', err); }
        finally    { this.loading = false; }
    }

    async refreshFromServer(showToast) {
        console.log('[SynapseSetup] refreshFromServer calling Apex refreshStatus…');
        this.loading = true;
        try {
            this.status = await refreshStatus();
            console.log('[SynapseSetup] refreshStatus returned', JSON.stringify(this.status));
            if (showToast && this.status?.configured) {
                this.toast('Connected', 'Archon Setup complete.', 'success');
            }
        } catch (err) {
            console.error('[SynapseSetup] refreshStatus error', err);
            this.toastError('Could not confirm status', err);
        } finally {
            this.loading = false;
        }
    }

    get statusBadgeClass() {
        if (!this.status) return 'badge';
        return this.status.configured ? 'badge badge-ok' : 'badge badge-warn';
    }
    get statusLabel() {
        if (!this.status) return 'Loading…';
        return this.status.configured ? 'Configured' : 'Not configured';
    }
    get configuredLine() {
        if (!this.status?.configured) return null;
        const who = this.status.configuredByEmail ? ` as ${this.status.configuredByEmail}` : '';
        return `Connected${who}`;
    }

    async handleAuthorize() {
        this.authorizing = true;
        try {
            const returnUrl = this.cleanReturnUrl();
            const { authorizeUrl } = await startSetup({ returnUrl });
            window.location.assign(authorizeUrl);
        } catch (err) {
            this.authorizing = false;
            this.toastError('Could not start authorization', err);
        }
    }

    async handleReset() {
        this.loading = true;
        try {
            await resetSetup();
            this.toast('Reset', 'Archon Setup cleared.', 'success');
            await this.loadStatus();
        } catch (err) {
            this.toastError('Reset failed', err);
        } finally { this.loading = false; }
    }

    cleanReturnUrl() {
        const u = new URL(window.location.href);
        u.searchParams.delete('synapse_setup');
        u.searchParams.delete('error');
        return u.toString();
    }

    cleanUrlBar() {
        const u = new URL(window.location.href);
        u.searchParams.delete('synapse_setup');
        u.searchParams.delete('error');
        window.history.replaceState({}, '', u.toString());
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant: variant || 'info' }));
    }
    toastError(title, err) {
        const msg = err?.body?.message || err?.message || 'Unknown error';
        this.toast(title, msg, 'error');
    }
}
