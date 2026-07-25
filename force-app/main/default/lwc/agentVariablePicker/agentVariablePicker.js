import { LightningElement, api, track } from 'lwc';

/**
 * Merge-field / variable insert popover — replaces lightning-button-menu
 * for this one job. A plain dropdown menu can't show a token AND its
 * description on the same line without truncating both, so the list read
 * as a wall of cryptic {!...} strings. This is a wider, grouped, searchable
 * popover instead — positioned via getBoundingClientRect so it always
 * escapes the properties panel's own scroll/overflow clipping.
 *
 * Drop-in replacement: still fires a "select" CustomEvent with
 * detail.value = the token, exactly like lightning-menu-item's onselect,
 * so every existing handler (handleInsertFieldToken etc.) needed no
 * changes — only e.currentTarget.dataset.key/part still work because
 * those data-* attributes live on THIS element's host tag in the parent's
 * template, same as they did on the old lightning-button-menu.
 */
export default class AgentVariablePicker extends LightningElement {
    @api variables = [];

    @track open = false;
    @track search = '';
    _posStyle = '';

    get filteredGroups() {
        const q = (this.search || '').trim().toLowerCase();
        const list = (this.variables || []).filter(v =>
            !q || v.token.toLowerCase().includes(q) || (v.hint || '').toLowerCase().includes(q)
        );
        const order = ['Record', 'AI output', 'Input', 'Variables', 'Current user', 'Organization'];
        const groups = new Map();
        for (const v of list) {
            const cat = this.categoryFor(v.token);
            if (!groups.has(cat)) groups.set(cat, []);
            groups.get(cat).push(v);
        }
        return order
            .filter(cat => groups.has(cat))
            .map(cat => ({ label: cat, items: groups.get(cat) }));
    }

    get hasResults() { return this.filteredGroups.length > 0; }

    categoryFor(token) {
        if (token.startsWith('{!record.') || token === '{!recordId}') return 'Record';
        if (token.startsWith('{!ai.'))    return 'AI output';
        if (token.startsWith('{!input.')) return 'Input';
        if (token.startsWith('{!user.'))  return 'Current user';
        if (token.startsWith('{!org.'))   return 'Organization';
        return 'Variables';
    }

    get popoverStyle() { return this._posStyle; }

    handleToggle(e) {
        e.stopPropagation();
        if (this.open) { this.close(); return; }
        this.openPopover();
    }

    openPopover() {
        const btn = this.template.querySelector('.avp-trigger');
        const width = 320;
        const maxHeight = 360;
        let left = 8;
        let top = 8;
        if (btn) {
            const rect = btn.getBoundingClientRect();
            left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
            top = rect.bottom + 6;
            if (top + maxHeight > window.innerHeight - 8) {
                top = Math.max(8, rect.top - maxHeight - 6);
            }
        }
        this._posStyle = `top:${top}px; left:${left}px; width:${width}px; max-height:${maxHeight}px;`;
        this.search = '';
        this.open = true;
    }

    close() { this.open = false; }

    handleSearchChange(e) { this.search = e.target.value; }

    handleItemClick(e) {
        const token = e.currentTarget.dataset.token;
        this.close();
        this.dispatchEvent(new CustomEvent('select', { detail: { value: token } }));
    }

    stop(e) { e.stopPropagation(); }
}
