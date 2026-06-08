// version5 - Display DNIS in Agent Desktop Header
(function () {
  if (customElements.get("wxcc-last-contact-widget")) return;

  const template = document.createElement("template");
  template.innerHTML = `
    <style>
      :host {
        display: inline-flex;
        align-items: center;
        font-family: "CiscoSansTT", "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-size: 12px;
        color: #ccc;
        padding: 0 8px;
      }
      .lc-wrapper {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .lc-wrapper.no-call {
        opacity: 0.4;
      }
      .lc-label {
        font-weight: 600;
        color: #aaa;
      }
      .lc-value {
        font-weight: 700;
        color: #fff;
      }
      .lc-value.highlight {
        color: #07C160;
      }
      .lc-value.empty {
        color: #999;
        font-weight: 400;
      }
    </style>
    <div id="lc-wrapper" class="lc-wrapper no-call">
      <span class="lc-label">DNIS:</span>
      <span id="lc-value" class="lc-value empty">&mdash;</span>
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

    // ---------------------------------------------------------------
    // Receives $STORE.agentContact.taskSelected
    // taskSelected is the full task object; interaction is nested inside
    // ---------------------------------------------------------------
    set interactionData(val) {
      console.log("[WxccLastContactWidget] taskSelected received:", JSON.stringify(val));

      if (!val) {
        this._clearDisplay();
        return;
      }

      // taskSelected can contain the interaction directly or nested under .interaction
      const interaction = val.interaction || val;
      const cad = interaction.callAssociatedData || interaction.CAD || {};

      console.log("[WxccLastContactWidget] CAD keys:", Object.keys(cad));

      // -----------------------------------------------------------
      // 1. Extract the DNIS from CAD variables or interaction properties
      // -----------------------------------------------------------
      const dnis =
        cad["DNIS"]?.value ||
        cad["dnis"]?.value ||
        cad["dn"]?.value ||
        cad["DN"]?.value ||
        cad["dialedNumber"]?.value ||
        cad["DialedNumber"]?.value ||
        interaction.DNIS ||
        interaction.dnis ||
        interaction.dn ||
        interaction.DN ||
        null;

      console.log("[WxccLastContactWidget] DNIS:", dnis);

      if (dnis) {
        this._setDnis(dnis);

        // ---------------------------------------------------------
        // 2. CRM Lookup placeholder
        //    Once ready, uncomment and update the URL below to
        //    perform a CRM lookup using the extracted DNIS.
        // ---------------------------------------------------------
        // fetch(`https://your-crm.example.com/api/lookup?dnis=${encodeURIComponent(dnis)}`)
        //   .then(response => response.json())
        //   .then(data => {
        //     if (data.lastContactDate) {
        //       this._setLastContactDate(data.lastContactDate);
        //     }
        //   })
        //   .catch(err => {
        //     console.error("[WxccLastContactWidget] CRM lookup failed:", err);
        //   });
        // ---------------------------------------------------------

      } else {
        this._setNoData();
      }
    }

    // Receives $STORE.agentContact.isActiveCall
    set isCallInProgress(val) {
      console.log("[WxccLastContactWidget] isCallInProgress:", val);
      if (!val) this._clearDisplay();
    }

    // ---------------------------------------------------------------
    // Display helpers
    // ---------------------------------------------------------------
    _setDnis(dnis) {
      this._valueEl.textContent = dnis;
      this._valueEl.className = "lc-value highlight";
      this._wrapperEl.classList.remove("no-call");
    }

    _setNoData() {
      this._valueEl.textContent = "No data";
      this._valueEl.className = "lc-value empty";
      this._wrapperEl.classList.remove("no-call");
    }

    _clearDisplay() {
      this._valueEl.textContent = "\u2014";
      this._valueEl.className = "lc-value empty";
      this._wrapperEl.classList.add("no-call");
    }
  }

  customElements.define("wxcc-last-contact-widget", WxccLastContactWidget);
  console.log("[WxccLastContactWidget] Registered successfully v5");
})();
