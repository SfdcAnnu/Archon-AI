import { LightningElement, api, track } from 'lwc';
import listChatEnabledAgents from '@salesforce/apex/AgentChatController.listChatEnabledAgents';
import startSession from '@salesforce/apex/AgentChatController.startSession';
import sendTurn from '@salesforce/apex/AgentChatController.sendTurn';
import endSession from '@salesforce/apex/AgentChatController.endSession';

/**
 * Archon Chat — the embeddable chat widget. Drop it on a record page, an
 * app/home page, the utility bar, or open it as its own tab; it talks to
 * the same agents, sessions, and runtime as the full Agent Builder app via
 * AgentChatController (HTTP turns, no WebSocket needed in this surface).
 *
 * On a record page it automatically anchors the conversation to that
 * record (recordId + objectApiName flow into the session's record
 * context), so the agent's lookups and prebuilt actions bind to the
 * record the user is viewing.
 *
 * The session starts lazily on the FIRST message — merely rendering the
 * widget never creates a ChatSession__c.
 */
export default class ArchonChat extends LightningElement {
  /** ApiName__c of the agent to chat with. Blank → the user picks. */
  @api agentApiName = '';
  /** Empty-state line shown before the first message. */
  @api greeting = 'Hi! How can I help?';
  /** Widget height in px (tab target stretches to fill instead). */
  @api componentHeight = 520;
  /** Provided automatically on record pages. */
  @api recordId;
  @api objectApiName;

  @track messages = [];
  @track agents = [];
  agentName = '';
  pickedApiName = '';
  sessionId = null;
  input = '';
  sending = false;
  loadingAgents = false;
  errorText = '';
  _scrollPending = false;
  _seq = 0;

  connectedCallback() {
    if (this.agentApiName) {
      this.pickedApiName = this.agentApiName;
      this.agentName = this.agentApiName;
    } else {
      this.loadingAgents = true;
      listChatEnabledAgents({ filter: '' })
        .then(rows => {
          this.agents = rows || [];
          this.loadingAgents = false;
        })
        .catch(e => {
          this.errorText = this.friendly(e);
          this.loadingAgents = false;
        });
    }
  }

  renderedCallback() {
    if (this._scrollPending) {
      this._scrollPending = false;
      const list = this.template.querySelector('.messages');
      if (list) list.scrollTop = list.scrollHeight;
    }
  }

  get needsAgentPick() {
    return !this.pickedApiName;
  }
  get hasMessages() {
    return this.messages.length > 0;
  }
  get showGreeting() {
    return !this.needsAgentPick && !this.hasMessages && !this.sending;
  }
  get sendDisabled() {
    return this.sending || !this.input.trim();
  }
  get rootStyle() {
    const h = Number(this.componentHeight);
    return Number.isFinite(h) && h > 0 ? `height:${h}px` : 'height:100%';
  }

  pickAgent(event) {
    const apiName = event.currentTarget.dataset.apiname;
    const row = this.agents.find(a => a.apiName === apiName);
    this.pickedApiName = apiName;
    this.agentName = row ? row.name : apiName;
  }

  handleInput(event) {
    this.input = event.target.value;
  }

  handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.handleSend();
    }
  }

  async handleSend() {
    const text = this.input.trim();
    if (!text || this.sending) return;
    this.errorText = '';
    this.input = '';
    const ta = this.template.querySelector('textarea');
    if (ta) ta.value = '';
    this.pushMessage('user', text);
    this.sending = true;
    try {
      if (!this.sessionId) {
        const res = await startSession({
          agentApiName: this.pickedApiName,
          recordContextId: this.recordId || null,
          recordContextType: this.objectApiName || null,
        });
        this.sessionId = res.session.Id;
        if (res.session.AgentDefinition__r && res.session.AgentDefinition__r.Name) {
          this.agentName = res.session.AgentDefinition__r.Name;
        }
      }
      const result = await sendTurn({ sessionId: this.sessionId, userText: text, attachments: [] });
      const rows = result && result.newMessages ? result.newMessages : [];
      let gotReply = false;
      rows.forEach(m => {
        if (m.Role__c === 'Assistant' && m.Content__c) {
          this.pushMessage('assistant', m.Content__c);
          gotReply = true;
        }
      });
      if (!gotReply) {
        this.pushMessage('assistant', "I couldn't produce a reply just now — please try again.", true);
      }
    } catch (e) {
      this.pushMessage('assistant', this.friendly(e), true);
    } finally {
      this.sending = false;
      this._scrollPending = true;
    }
  }

  async handleEnd() {
    if (this.sessionId) {
      try {
        await endSession({ sessionId: this.sessionId });
      } catch (e) {
        /* ending is best-effort — the session expires on its own */
      }
    }
    this.sessionId = null;
    this.messages = [];
    this.errorText = '';
    if (!this.agentApiName) this.pickedApiName = '';
  }

  pushMessage(role, text, isError) {
    this._seq += 1;
    this.messages = [
      ...this.messages,
      {
        key: `m${this._seq}`,
        text,
        isUser: role === 'user',
        rowClass: role === 'user' ? 'row user' : 'row bot',
        bubbleClass: 'bubble ' + (role === 'user' ? 'user' : isError ? 'bot error' : 'bot'),
      },
    ];
    this._scrollPending = true;
  }

  friendly(e) {
    const raw =
      (e && e.body && (e.body.message || (Array.isArray(e.body) && e.body[0] && e.body[0].message))) ||
      (e && e.message) ||
      'Something went wrong.';
    return /<!doctype|<html/i.test(raw)
      ? 'The Archon server is starting up — try again in a few seconds.'
      : raw;
  }
}
