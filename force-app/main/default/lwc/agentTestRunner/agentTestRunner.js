import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import executeAgent from '@salesforce/apex/AgentBuilderController.executeAgent';

export default class AgentTestRunner extends LightningElement {
    @api agent;

    @track recordId      = '';
    @track runMode       = 'sync';
    @track inputPayload  = '{}';
    @track isRunning     = false;
    @track logs          = [];
    @track result        = null;
    @track hasRun        = false;

    get agentName()    { return (this.agent && this.agent.Name) || ''; }
    get agentApi()     { return (this.agent && this.agent.ApiName__c) || ''; }
    get isDisabled()   { return this.isRunning || !this.recordId; }
    get runButtonLabel() { return this.isRunning ? 'Running…' : 'Run agent'; }
    get resultBadgeLabel() { return (this.result && this.result.success) ? 'Success' : 'Error'; }
    get resultBadgeClass() { return (this.result && this.result.success) ? 'badge-success' : 'badge-error'; }
    get payloadPlaceholder() { return '{"source": "test_runner"}'; }

    get runModeOptions() {
        return [
            { label: 'Sync — wait for result', value: 'sync' },
            { label: 'Async — fire and forget', value: 'async' }
        ];
    }

    get successRate() {
        return this.result?.success ? '100' : '0';
    }

    get scoreBarStyle() {
        const score = (this.result && this.result.agentScore) || 0;
        const color = score >= 80 ? '#2e844a' : score >= 50 ? '#ff9900' : '#c23934';
        return `width:${score}%;background:${color};height:4px;border-radius:2px;transition:width .5s`;
    }

    get priorityStyle() {
        const p = this.result && this.result.agentPriority;
        return p === 'Hot' ? 'color:#c23934' : p === 'Warm' ? 'color:#ff9900' : 'color:#2e844a';
    }

    handleRecordId(e)   { this.recordId = e.target.value; }
    handleRunMode(e)    { this.runMode = e.detail.value; }
    handlePayload(e)    { this.inputPayload = e.target.value; }

    async handleRun() {
        this.isRunning = true;
        this.hasRun = true;
        this.logs = [];
        this.result = null;

        this.addLog('info',  `Agent started: ${this.agentApi}`);
        this.addLog('info',  `Record ID: ${this.recordId}`);
        this.addLog('ai',    'Claude reasoning started…');

        const startMs = Date.now();
        try {
            const res = await executeAgent({
                agentApiName:    this.agentApi,
                recordId:        this.recordId,
                runMode:         this.runMode,
                inputPayloadJson: this.inputPayload
            });

            const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

            if (res.toolsUsed) {
                res.toolsUsed.split(',').forEach(t => {
                    this.addLog('tool', `→ ${t.trim()}`);
                });
            }

            this.addLog(res.success ? 'success' : 'error',
                res.success ? `✓ Complete in ${elapsed}s` : `✗ Error: ${res.agentReason}`);

            this.result = { ...res, elapsed };

            if (res.success) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Agent complete',
                    message: `Score: ${res.agentScore} · ${res.agentPriority}`,
                    variant: 'success'
                }));
            }

        } catch (err) {
            const msg = err?.body?.message || err.message || 'Unknown error';
            this.addLog('error', `✗ ${msg}`);
            this.dispatchEvent(new ShowToastEvent({ title: 'Execution failed', message: msg, variant: 'error' }));
        } finally {
            this.isRunning = false;
        }
    }

    addLog(type, message) {
        const ts = new Date().toISOString().substr(14, 8);
        const msgClass = type === 'success' ? 'log-msg success'
                       : type === 'error'   ? 'log-msg error'
                       : type === 'tool'    ? 'log-msg tool'
                       : type === 'ai'      ? 'log-msg ai'
                       : 'log-msg info';
        this.logs = [...this.logs, {
            id:        this.logs.length,
            ts,
            message,
            msgClass,
            isSuccess: type === 'success',
            isError:   type === 'error',
            isTool:    type === 'tool',
            isAi:      type === 'ai',
            isInfo:    type === 'info'
        }];
    }

    handleBack() {
        this.dispatchEvent(new CustomEvent('back'));
    }
}
