(function () {
  // Guard: prevent re-registration if script loads twice
  if (customElements.get("wxcc-last-contact-widget")) return;

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
      .lc-value.empty {
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
        <span class="lc-value empty" id="lc-value">—</span>
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
    }

    // Receives $STORE.agentContact.taskSelected.interaction
    set interactionData(val) {
      console.log("[WxccLastContactWidget] interactionData received:", JSON.stringify(val));
      this._processInteraction(val);
    }

    // Receives $STORE.agentContact.isActiveCall
    set isCallInProgress(val) {
      console.log("[WxccLastContactWidget] isCallInProgress:", val);
      if (!val) this._clearDisplay();
    }

    _processInteraction(interaction) {
      if (!interaction) {
        this._clearDisplay();
        return;
      }

      const cad = interaction.callAssociatedData || interaction.CAD || {};
      console.log("[WxccLastContactWidget] CAD keys:", Object.keys(cad));

      const raw =
        cad["lastContactDate"]?.value ||
        cad["LastContactDate"]?.value ||
        cad["last_contact_date"]?.value ||
        null;

      console.log("[WxccLastContactWidget] lastContactDate:", raw);

      if (raw) {
        this._setDate(raw);
      } else {
        this._setNoData();
      }
    }

    _setDate(raw) {
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
      } catch (_) {}
      this._valueEl.textContent = display;
      this._valueEl.className = "lc-value highlight";
      this._wrapperEl.classList.remove("no-call");
    }

    _setNoData() {
      this._valueEl.textContent = "No data";
      this._valueEl.className = "lc-value empty";
      this._wrapperEl.classList.remove("no-call");
    }

    _clearDisplay() {
      this._valueEl.textContent = "—";
      this._valueEl.className = "lc-value empty";
      this._wrapperEl.classList.add("no-call");
    }
  }

  customElements.define("wxcc-last-contact-widget", WxccLastContactWidget);
  console.log("[WxccLastContactWidget] Registered successfully");
})();
