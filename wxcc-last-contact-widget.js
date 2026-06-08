// version6 - Enhanced DNIS extraction with deep debug logging
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
      .lc-value.warn {
        color: #FFA500;
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
      console.log("[WxccLastContactWidget] Constructor called");
    }

    connectedCallback() {
      console.log("[WxccLastContactWidget] Mounted to DOM (v6)");
    }

    // -----------------------------------------------------------------
    // Debug helper: logs all top-level keys and their types for an object
    // -----------------------------------------------------------------
    _debugLogObject(label, obj) {
      if (!obj || typeof obj !== "object") {
        console.log(`[WxccLastContactWidget] ${label}: `, obj);
        return;
      }
      const keys = Object.keys(obj);
      console.log(`[WxccLastContactWidget] ${label} keys (${keys.length}):`, keys);
      keys.forEach((k) => {
        const v = obj[k];
        const type = typeof v;
        if (type === "object" && v !== null) {
          console.log(`[WxccLastContactWidget]   ${label}.${k} => [${type}] keys:`, Object.keys(v));
        } else {
          console.log(`[WxccLastContactWidget]   ${label}.${k} => [${type}]`, v);
        }
      });
    }

    // -----------------------------------------------------------------
    // Receives $STORE.agentContact.taskSelected
    // -----------------------------------------------------------------
    set interactionData(val) {
      console.log("[WxccLastContactWidget] === interactionData setter triggered ===");

      if (!val) {
        console.log("[WxccLastContactWidget] val is null/undefined — no active task");
        this._clearDisplay();
        return;
      }

      // ---------- Deep debug logging ----------
      this._debugLogObject("val (taskSelected)", val);

      const interaction = val.interaction || val;
      this._debugLogObject("interaction", interaction);

      const cad = interaction.callAssociatedData || interaction.CAD || {};
      this._debugLogObject("CAD", cad);

      const mediaProp = interaction.mediaProperties || {};
      this._debugLogObject("mediaProperties", mediaProp);

      // Also check for callAssociatedDetails (alternate key in some versions)
      const cad2 = interaction.callAssociatedDetails || {};
      if (Object.keys(cad2).length > 0) {
        this._debugLogObject("callAssociatedDetails", cad2);
      }

      // ---------- DNIS extraction — check every known location ----------
      const dnis =
        // CAD variables (primary)
        cad["DNIS"]?.value ||
        cad["dnis"]?.value ||
        cad["dn"]?.value ||
        cad["DN"]?.value ||
        cad["dialedNumber"]?.value ||
        cad["DialedNumber"]?.value ||
        cad["OutDialNumber"]?.value ||
        cad["outDialNumber"]?.value ||
        cad["outDial"]?.value ||
        cad["BN_NUMBER"]?.value ||
        cad["bn_number"]?.value ||
        cad["CampaignPhoneNumber"]?.value ||
        cad["campaignPhoneNumber"]?.value ||
        cad["phoneNumber"]?.value ||
        cad["PhoneNumber"]?.value ||
        cad["ani"]?.value ||
        cad["ANI"]?.value ||
        cad["destination"]?.value ||
        cad["Destination"]?.value ||
        // CAD values may be strings directly (not objects with .value)
        (typeof cad["DNIS"] === "string" ? cad["DNIS"] : null) ||
        (typeof cad["dnis"] === "string" ? cad["dnis"] : null) ||
        (typeof cad["DN"] === "string" ? cad["DN"] : null) ||
        (typeof cad["dn"] === "string" ? cad["dn"] : null) ||
        // callAssociatedDetails
        cad2["DNIS"]?.value ||
        cad2["dnis"]?.value ||
        // interaction-level properties
        interaction.DNIS ||
        interaction.dnis ||
        interaction.dn ||
        interaction.DN ||
        interaction.ani ||
        interaction.ANI ||
        interaction.destAgentAddress ||
        interaction.origin ||
        interaction.dialedNumber ||
        interaction.outDialNumber ||
        // mediaProperties
        mediaProp.DNIS ||
        mediaProp.dnis ||
        mediaProp.DN ||
        mediaProp.dn ||
        mediaProp.ani ||
        mediaProp.ANI ||
        // taskSelected top-level
        val.DNIS ||
        val.dnis ||
        val.dn ||
        val.DN ||
        val.ani ||
        val.ANI ||
        null;

      console.log("[WxccLastContactWidget] Resolved DNIS:", dnis);

      if (dnis) {
        this._setDnis(dnis);

        // ---------------------------------------------------------
        // CRM Lookup placeholder
        // Uncomment and update the URL to perform a CRM lookup.
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
        // We received task data but could not find DNIS
        this._setNotFound();
      }
    }

    // Receives $STORE.agentContact.isActiveCall
    set isCallInProgress(val) {
      console.log("[WxccLastContactWidget] isCallInProgress:", val);
      if (!val) this._clearDisplay();
    }

    // -----------------------------------------------------------------
    // Display helpers
    // -----------------------------------------------------------------
    _setDnis(dnis) {
      this._valueEl.textContent = dnis;
      this._valueEl.className = "lc-value highlight";
      this._wrapperEl.classList.remove("no-call");
    }

    _setNotFound() {
      this._valueEl.textContent = "DNIS not found";
      this._valueEl.className = "lc-value warn";
      this._wrapperEl.classList.remove("no-call");
    }

    _clearDisplay() {
      this._valueEl.textContent = "\u2014";
      this._valueEl.className = "lc-value empty";
      this._wrapperEl.classList.add("no-call");
    }
  }

  customElements.define("wxcc-last-contact-widget", WxccLastContactWidget);
  console.log("[WxccLastContactWidget] Registered successfully v6");
})();
