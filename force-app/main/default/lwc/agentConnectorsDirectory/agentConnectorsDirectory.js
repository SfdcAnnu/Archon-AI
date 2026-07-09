import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getDirectory  from '@salesforce/apex/AgentConnectorController.getDirectory';
import startOAuth    from '@salesforce/apex/AgentConnectorController.startOAuth';
import disconnect    from '@salesforce/apex/AgentConnectorController.disconnect';

const CATEGORIES = [
    { key: 'All',          label: 'All' },
    { key: 'Storage',      label: 'Storage' },
    { key: 'Email',        label: 'Email' },
    { key: 'Channels',     label: 'Channels' },
    { key: 'CRM',          label: 'CRM' },
    { key: 'Productivity', label: 'Productivity' }
];

export default class AgentConnectorsDirectory extends LightningElement {
    @api open = false;
    /** When set by the opener, auto-starts the connect flow for this provider. */
    @api startProvider = null;

    @track entries          = [];
    @track activeCategory   = 'All';
    @track search           = '';
    @track loading          = false;
    // API-key providers are out of scope for this phase; left as null and unused.
    @track apiKeyModal      = null;

    _autoStarted = null;

    connectedCallback() {
        this.loadDirectory();
        this.maybeHandleOauthReturn();
    }

    renderedCallback() {
        if (!this.open) {
            this._autoStarted = null;
            return;
        }
        // Auto-fire the connect flow when opened for a specific provider
        // (from a "+ Connect" tile). Only once per open, and only after
        // the directory has loaded so we can resolve the entry.
        if (this.startProvider &&
            this._autoStarted !== this.startProvider &&
            !this.loading && this.entries.length > 0) {
            this._autoStarted = this.startProvider;
            this.connectProvider(this.startProvider);
        }
    }

    // ── Loading ──────────────────────────────────────────────────────
    async loadDirectory() {
        this.loading = true;
        try {
            const data = await getDirectory();
            this.entries = data.map(e => this.decorate(e));
        } catch (err) {
            this.toastError('Could not load connectors', err);
        } finally {
            this.loading = false;
        }
    }

    decorate(e) {
        const isConnected   = e.status === 'Connected';
        const isPending     = e.status === 'Pending';
        const isError       = e.status === 'Error';
        const isDisconnected = e.status === 'Disconnected' || e.status === 'NotConfigured';

        const iconUrl = e.iconStaticResource
            ? `/resource/${e.iconStaticResource}`
            : null;

        return {
            ...e,
            iconUrl,
            iconTint:         `background:${this.tint(e.brandColor)};`,
            statusPillClass:  this.pillClass(e.status),
            statusLabel:      this.statusLabel(e.status),
            isConnected,
            isPending,
            isError,
            isDisconnected,
            showConnectBtn:   isDisconnected,
            showManageBtn:    isConnected || isError,
            showRetryBtn:     isPending,
            connectedAsLine:  isConnected && e.accountEmail ? `Connected as ${e.accountEmail}` : null
        };
    }

    tint(hex) {
        if (!hex) return '#e8f4fd';
        // very light tint of brand color
        return hex + '1a'; // 10% alpha — works in modern browsers
    }
    pillClass(status) {
        switch (status) {
            case 'Connected':    return 'pill pill-ok';
            case 'Pending':      return 'pill pill-warn';
            case 'Error':        return 'pill pill-err';
            case 'Disconnected': return 'pill pill-mute';
            default:             return 'pill pill-mute';
        }
    }
    statusLabel(status) {
        if (status === 'NotConfigured') return 'Not connected';
        return status;
    }

    // ── Filtering ───────────────────────────────────────────────────
    get categoryItems() {
        return CATEGORIES.map(c => ({
            ...c,
            cssClass: c.key === this.activeCategory ? 'cat-item cat-item-active' : 'cat-item'
        }));
    }

    get visibleEntries() {
        const q = (this.search || '').trim().toLowerCase();
        return this.entries.filter(e => {
            if (this.activeCategory !== 'All' && e.category !== this.activeCategory) return false;
            if (!q) return true;
            return (
                (e.displayName || '').toLowerCase().includes(q) ||
                (e.description || '').toLowerCase().includes(q) ||
                (e.providerKey || '').toLowerCase().includes(q)
            );
        });
    }

    get isEmpty() {
        return !this.loading && this.visibleEntries.length === 0;
    }

    // ── Event handlers ──────────────────────────────────────────────
    handleCategoryClick(e) {
        this.activeCategory = e.currentTarget.dataset.key;
    }
    handleSearch(e) { this.search = e.target.value; }
    handleClose(e) {
        e?.stopPropagation();
        this.dispatchEvent(new CustomEvent('close'));
    }
    stopProp(e) { e.stopPropagation(); }

    async handleConnect(e) {
        await this.connectProvider(e.currentTarget.dataset.provider);
    }

    /** Shared connect flow — used by the tile button AND the auto-start path. */
    async connectProvider(providerKey) {
        const entry = this.entries.find(x => x.providerKey === providerKey);
        if (!entry) return;

        if (providerKey !== 'salesforce_mcp') {
            this.toast('Coming soon', `${entry.displayName} is not wired in this build. Salesforce MCP is supported today.`, 'info');
            return;
        }

        try {
            const returnUrl = this.buildReturnUrl();
            const { authorizeUrl } = await startOAuth({
                providerKey,
                displayName: entry.displayName,
                returnUrl
            });
            window.location.assign(authorizeUrl);
        } catch (err) {
            this.toastError('Could not start OAuth', err);
        }
    }

    async handleDisconnect(e) {
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        try {
            await disconnect({ connectorId: id });
            this.toast('Disconnected', 'Connector revoked.', 'success');
            await this.loadDirectory();
        } catch (err) {
            this.toastError('Disconnect failed', err);
        }
    }

    // API-key modal handlers were removed — Phase 1 only ships OAuth (Salesforce MCP).
    handleApiKeyCancel() { this.apiKeyModal = null; }

    // ── OAuth return handling ──────────────────────────────────────
    // The server's /api/oauth/callback finishes the dance and redirects the
    // browser back to this Lightning page with ?synapse_connected=1 (or =0).
    buildReturnUrl() {
        const url = new URL(window.location.href);
        url.searchParams.delete('synapse_connected');
        url.searchParams.delete('error');
        url.searchParams.delete('connectorId');
        return url.toString();
    }

    async maybeHandleOauthReturn() {
        const params = new URLSearchParams(window.location.search);
        const flag = params.get('synapse_connected');
        if (flag === null) return;

        if (flag === '1') {
            this.toast('Connected', 'OAuth complete.', 'success');
        } else {
            this.toastError('OAuth failed', { body: { message: params.get('error') || 'Unknown error' } });
        }
        const clean = new URL(window.location.href);
        clean.searchParams.delete('synapse_connected');
        clean.searchParams.delete('connectorId');
        clean.searchParams.delete('error');
        window.history.replaceState({}, '', clean.toString());
        await this.loadDirectory();
    }

    // ── Toasts ─────────────────────────────────────────────────────
    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant: variant || 'info' }));
    }
    toastError(title, err) {
        const msg = err && err.body ? (err.body.message || JSON.stringify(err.body)) : (err && err.message) || 'Unknown error';
        this.toast(title, msg, 'error');
    }
}
