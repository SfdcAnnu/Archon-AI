import { LightningElement, api, track } from 'lwc';
import generateAgent from '@salesforce/apex/AgentGeneratorController.generateAgent';

const STEP_INPUT = 'input';
const STEP_QUESTIONS = 'questions';

/**
 * "Describe your agent" modal — an alternative to manual drag-and-drop.
 * One requirement submission, at most one clarifying-question round-trip,
 * then hands the generated {agent, nodes, connections, setupChecklist}
 * back to agentCanvas via the `generated` event for it to render on the
 * SAME canvas a hand-built agent uses (see hydrateFromGeneratedResult).
 */
export default class AgentGenerateModal extends LightningElement {
    @api open = false;

    @track step = STEP_INPUT;
    @track requirementText = '';
    @track fileName = null;
    @track _fileBase64 = null;
    @track generating = false;
    @track waking = false;
    @track errorMessage = null;

    @track questions = [];
    @track answers = [];
    @track extraNotes = '';
    _qaHistory = [];

    get isInputStep()     { return this.step === STEP_INPUT; }
    get isQuestionsStep() { return this.step === STEP_QUESTIONS; }
    get generateDisabled() { return this.requirementText.trim().length === 0 || this.generating; }
    get submitAnswersDisabled() {
        return this.generating || this.answers.some(a => !a || !a.trim());
    }

    get questionRows() {
        return this.questions.map((q, i) => ({ index: i, text: q, value: this.answers[i] || '' }));
    }

    handleTextChange(e) { this.requirementText = e.target.value; }

    async handleFileChange(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        this.fileName = file.name;
        this._fileBase64 = await this.readAsBase64(file);
    }
    handleRemoveFile() {
        this.fileName = null;
        this._fileBase64 = null;
    }
    readAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                const commaIx = dataUrl.indexOf(',');
                resolve(commaIx >= 0 ? dataUrl.slice(commaIx + 1) : dataUrl);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    async handleGenerate() {
        await this.runGenerate({
            requirementText: this.requirementText,
            fileBase64: this._fileBase64,
            qaHistoryJson: null
        });
    }

    handleAnswerChange(e) {
        const idx = Number(e.currentTarget.dataset.idx);
        const next = [...this.answers];
        next[idx] = e.target.value;
        this.answers = next;
    }
    handleExtraNotesChange(e) { this.extraNotes = e.target.value; }

    async handleSubmitAnswers() {
        this._qaHistory = this.questions.map((q, i) => ({ question: q, answer: this.answers[i] || '' }));
        // A free-form note isn't tied to any specific asked question, but the
        // server only understands qaHistory as {question, answer} pairs — a
        // clearly-labeled pseudo-entry reads naturally in the prompt (see
        // buildUserMessage in agent-generator/generate.ts) without needing a
        // separate field end-to-end.
        if (this.extraNotes && this.extraNotes.trim()) {
            this._qaHistory.push({ question: 'Anything else the user wants to add', answer: this.extraNotes.trim() });
        }
        await this.runGenerate({
            requirementText: this.requirementText,
            fileBase64: this._fileBase64,
            qaHistoryJson: JSON.stringify(this._qaHistory)
        });
    }

    /**
     * The Archon server free-tier instance sleeps when idle — the first
     * call after a while wakes it (~30-60s) and Render's own edge answers
     * with an HTML "Application loading" page in the meantime.
     * AgentGeneratorController turns that into a SERVER_WAKING-prefixed
     * error (same signal agentPropertiesPanel's catalog loader already
     * retries on) instead of surfacing raw HTML — retry quietly here
     * rather than showing the user a scary error on the very first try.
     */
    async runGenerate(args) {
        this.generating = true;
        this.errorMessage = null;
        this.waking = false;
        const MAX_ATTEMPTS = 8;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const result = await generateAgent(args);
                this.generating = false;
                this.waking = false;
                this.handleResult(result);
                return;
            } catch (e) {
                const msg = e?.body?.message || e?.message || '';
                const waking = /SERVER_WAKING/i.test(msg);
                if (!waking || attempt === MAX_ATTEMPTS) {
                    this.errorMessage = waking
                        ? 'The Archon server is taking longer than usual to wake up — please try again in a moment.'
                        : (msg || 'Generation failed.');
                    this.generating = false;
                    this.waking = false;
                    return;
                }
                this.waking = true;
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                await new Promise(resolve => setTimeout(resolve, 8000));
            }
        }
    }

    handleResult(result) {
        if (result.kind === 'questions') {
            this.questions = result.questions || [];
            this.answers = new Array(this.questions.length).fill('');
            this.step = STEP_QUESTIONS;
            return;
        }
        // kind === 'agent'
        this.dispatchEvent(new CustomEvent('generated', { detail: result }));
        this.resetLocalState();
    }

    resetLocalState() {
        this.step = STEP_INPUT;
        this.requirementText = '';
        this.fileName = null;
        this._fileBase64 = null;
        this.questions = [];
        this.answers = [];
        this.extraNotes = '';
        this._qaHistory = [];
        this.errorMessage = null;
    }

    handleClose() {
        this.resetLocalState();
        this.dispatchEvent(new CustomEvent('close'));
    }
    stop(e) { e.stopPropagation(); }
}
