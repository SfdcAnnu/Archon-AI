import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getStatus     from '@salesforce/apex/SynapseSetupController.getStatus';
import refreshStatus from '@salesforce/apex/SynapseSetupController.refreshStatus';
import startSetup    from '@salesforce/apex/SynapseSetupController.startSetup';
import resetSetup    from '@salesforce/apex/SynapseSetupController.resetSetup';

export default class SynapseSetup extends LightningElement {
    @track status = null;
    @track loading = false;
    @track authorizing = false;

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
