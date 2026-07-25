import { LightningElement, api } from 'lwc';

const CATEGORY_ICON = {
    connector: 'utility:connected_apps',
    ai_engine: 'utility:einstein',
    knowledge_base: 'utility:knowledge_base',
    review: 'utility:preview',
    other: 'utility:info'
};
const CATEGORY_LABEL = {
    connector: 'Connect a provider',
    ai_engine: 'AI credentials',
    knowledge_base: 'Knowledge base',
    review: 'Review',
    other: 'Other'
};

/** Presentational — all state (the checklist itself, toggling) lives in agentCanvas.js. */
export default class AgentSetupChecklist extends LightningElement {
    @api open = false;
    @api items = [];

    get rows() {
        return (this.items || []).map((item, index) => ({
            ...item,
            index,
            icon: CATEGORY_ICON[item.category] || CATEGORY_ICON.other,
            categoryLabel: CATEGORY_LABEL[item.category] || 'Other',
            rowClass: item.done ? 'asc-row asc-row--done' : 'asc-row'
        }));
    }
    get openCount() { return (this.items || []).filter(i => !i.done).length; }
    get allDone() { return this.items && this.items.length > 0 && this.openCount === 0; }

    handleToggle(e) {
        const index = Number(e.currentTarget.dataset.idx);
        this.dispatchEvent(new CustomEvent('toggleitem', { detail: { index } }));
    }
    handleClose() { this.dispatchEvent(new CustomEvent('close')); }
    stop(e) { e.stopPropagation(); }
}
