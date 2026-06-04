/**
 * WxCC Last Contact Date Header Widget
 * Hosted on GitHub Pages, loaded into the WxCC Advanced Header via Desktop Layout JSON.
 *
 * Reads `lastContactDate` from the interaction's CAD (Call Associated Data) variables
 * which are populated by the flow and exposed via the WxCC Desktop SDK / STORE.
 */

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: inline-flex;
      align-items: center;
      height: 64px;
      font-family: 'CiscoSansTT Regular', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    }

    .lc-container {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 6px 14px;
      height: 36px;
      box-sizing: border-box;
      transition: background 0.2s ease;
    }

    .lc-container:hover {
      background: rgba(255, 255, 255, 0.14);
    }

    .lc-container.no-call {
      opacity: 0.4;
    }

    .lc-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      color: #00BCEB;
      flex-shrink: 0;
    }

    .lc-icon svg {
      width: 16px;
      height: 16px;
    }

    .lc-content {
      display: flex;
      flex-direction: column;
      justify-content: center;
      line-height: 1.2;
    }

    .lc-label {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: rgba(255,255,255,0.5);
      white-space: nowrap;
    }

    .lc-value {
      font-size: 12px;
      font-weight: 500;
      color: #ffffff;
      white-space: nowrap;
    }

    .lc-value.loading {
      color: rgba(255,255,255,0.4);
      font-style: italic;
    }

    .lc-value.highlight {
      color: #00BCEB;
    }
  </style>

  <div class="lc-container no-call" id="lc-wrapper">
    <div class="lc-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
    </div>
    <div class="lc-content">
      <span class="lc-label">Last Contacted</span>
      <span class="lc-value loading" id="lc-value">—</span>
    </div>
  </div>
`;

class WxccLastContactWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this._valueEl = this.shadowRoot.getElementById("lc-value");
    this._wrapperEl = this.shadowRoot.getElementById("lc-wrapper");
    this._unsubscribe = null;
  }

  connectedCallback() {
    this._trySubscribe();
  }

  disconnectedCallback() {
    if (typeof this._unsubscribe === "function") {
      this._unsubscribe();
    }
  }

  /**
   * Observed attributes allow the desktop layout to pass values directly
   * via the `attributes` property in the JSON layout as a fallback.
   */
  static get observedAttributes() {
    return ["last-contact-date"];
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === "last-contact-date" && newVal) {
      this._setDate(newVal);
    }
  }

  _trySubscribe() {
    // Subscribe to WxCC Desktop SDK store changes
    // The SDK is available globally as window.Desktop when running inside AgentX
    const maxAttempts = 20;
    let attempts = 0;

    const poll = setInterval(() => {
      attempts++;

      if (window.Desktop && window.Desktop.agentContact) {
        clearInterval(poll);
        this._subscribeToStore();
      } else if (attempts >= maxAttempts) {
        clearInterval(poll);
        console.warn("[WxccLastContactWidget] Desktop SDK not available.");
      }
    }, 500);
  }

  _subscribeToStore() {
    try {
      // Subscribe to task/interaction updates
      this._unsubscribe = window.Desktop.agentContact.addEventListener(
        "eAgentContact",
        (event) => {
          this._handleContactEvent(event);
        }
      );

      // Also check if there's already an active task on load
      this._checkCurrentTask();
    } catch (err) {
      console.error("[WxccLastContactWidget] Error subscribing to store:", err);
    }
  }

  _checkCurrentTask() {
    try {
      const tasks = window.Desktop.agentContact.taskMap;
      if (tasks && tasks.size > 0) {
        // Get first active task
        const task = tasks.values().next().value;
        this._extractAndDisplay(task);
      }
    } catch (err) {
      // No active tasks yet — that's fine
    }
  }

  _handleContactEvent(event) {
    if (!event || !event.data) return;

    const { type, interaction } = event.data;

    // Show on offer or connect events
    if (
      type === "AgentContactOffered" ||
      type === "AgentContactAssigned" ||
      type === "AgentOfferContactRinging"
    ) {
      this._extractAndDisplay(interaction);
    }

    // Clear when contact ends
    if (
      type === "AgentContactEnded" ||
      type === "AgentContactWrappedUp"
    ) {
      this._clearDisplay();
    }
  }

  _extractAndDisplay(interaction) {
    if (!interaction) return;

    // CAD variables are in interaction.callAssociatedData
    // The variable name must match exactly what's set in the flow
    const cad = interaction.callAssociatedData || {};

    // Try to find lastContactDate — check both camelCase and common variants
    const raw =
      cad["lastContactDate"]?.value ||
      cad["LastContactDate"]?.value ||
      cad["last_contact_date"]?.value ||
      null;

    if (raw) {
      this._setDate(raw);
    } else {
      this._setNoData();
    }
  }

  _setDate(raw) {
    // Attempt to format nicely if it looks like a date
    let display = raw;
    try {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        display = d.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
      }
    } catch (_) {
      // Use raw value as-is
    }

    this._valueEl.textContent = display;
    this._valueEl.className = "lc-value highlight";
    this._wrapperEl.classList.remove("no-call");
  }

  _setNoData() {
    this._valueEl.textContent = "No data";
    this._valueEl.className = "lc-value loading";
    this._wrapperEl.classList.remove("no-call");
  }

  _clearDisplay() {
    this._valueEl.textContent = "—";
    this._valueEl.className = "lc-value loading";
    this._wrapperEl.classList.add("no-call");
  }
}

customElements.define("wxcc-last-contact-widget", WxccLastContactWidget);
