// version8 - Multi-binding diagnostic DNIS extraction
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
      this._currentDnis = null;
      console.log("[WxccLastContactWidget] Constructor called (v8)");
    }

    connectedCallback() {
      console.log("[WxccLastContactWidget] Mounted to DOM (v8)");
    }

    disconnectedCallback() {
      console.log("[WxccLastContactWidget] Removed from DOM");
    }

    // =================================================================
    // Debug helper — logs keys 2 levels deep
    // =================================================================
    _debugLogObject(label, obj) {
      if (!obj || typeof obj !== "object") {
        console.log(`[WxccLastContactWidget] ${label}:`, obj);
        return;
      }
      const keys = Object.keys(obj);
      console.log(`[WxccLastContactWidget] ${label} keys (${keys.length}):`, keys);
      keys.forEach((k) => {
        const v = obj[k];
        const type = typeof v;
        if (type === "object" && v !== null) {
          const subKeys = Object.keys(v);
          console.log(`[WxccLastContactWidget]   ${label}.${k} => [${type}] keys:`, subKeys);
          // Go one more level deep for key objects
          subKeys.forEach((sk) => {
            const sv = v[sk];
            const stype = typeof sv;
            if (stype === "object" && sv !== null) {
              console.log(`[WxccLastContactWidget]     ${label}.${k}.${sk} => [${stype}] keys:`, Object.keys(sv));
            } else {
              console.log(`[WxccLastContactWidget]     ${label}.${k}.${sk} => [${stype}]`, sv);
            }
          });
        } else {
          console.log(`[WxccLastContactWidget]   ${label}.${k} => [${type}]`, v);
        }
      });
    }

    // =================================================================
    // SETTER 1: $STORE.agentContact (entire contact store)
    // =================================================================
    set agentContact(val) {
      console.log("[WxccLastContactWidget] === SETTER: agentContact ===");
      if (!val || typeof val !== "object") {
        console.log("[WxccLastContactWidget] agentContact is null/empty:", val);
        return;
      }
      this._debugLogObject("agentContact", val);

      // Try to find interaction data anywhere inside the store
      if (val.taskSelected) {
        console.log("[WxccLastContactWidget] agentContact.taskSelected found");
        this._processContactData(val.taskSelected, "agentContact.taskSelected");
      }
      if (val.taskMap) {
        console.log("[WxccLastContactWidget] agentContact.taskMap found");
        this._processTaskMap(val.taskMap, "agentContact.taskMap");
      }
      if (val.outdialContactData) {
        console.log("[WxccLastContactWidget] agentContact.outdialContactData found");
        this._processContactData(val.outdialContactData, "agentContact.outdialContactData");
      }
      // Check for any key containing "task" or "contact" or "interaction"
      Object.keys(val).forEach(k => {
        const lower = k.toLowerCase();
        if (lower.includes("task") || lower.includes("contact") || lower.includes("interaction") || lower.includes("preview")) {
          console.log(`[WxccLastContactWidget] agentContact has relevant key: ${k}`);
          if (val[k] && typeof val[k] === "object") {
            this._processContactData(val[k], `agentContact.${k}`);
          }
        }
      });
    }

    // =================================================================
    // SETTER 2: $STORE.agentContact.taskMap
    // =================================================================
    set taskMap(val) {
      console.log("[WxccLastContactWidget] === SETTER: taskMap ===");
      if (!val || typeof val !== "object") {
        console.log("[WxccLastContactWidget] taskMap is null/empty:", val);
        return;
      }
      this._processTaskMap(val, "taskMap");
    }

    _processTaskMap(taskMap, source) {
      this._debugLogObject(source, taskMap);
      // taskMap could be a Map or a plain object
      let entries;
      if (taskMap instanceof Map) {
        entries = [...taskMap.entries()];
      } else {
        entries = Object.entries(taskMap);
      }
      console.log(`[WxccLastContactWidget] [${source}] entries count:`, entries.length);
      entries.forEach(([id, task]) => {
        console.log(`[WxccLastContactWidget] [${source}] task ID: ${id}`);
        this._processContactData(task, `${source}["${id}"]`);
      });
    }

    // =================================================================
    // SETTER 3: $STORE.agentContact.taskSelected.interaction
    // =================================================================
    set activeInteraction(val) {
      console.log("[WxccLastContactWidget] === SETTER: activeInteraction ===");
      if (!val || typeof val !== "object") {
        console.log("[WxccLastContactWidget] activeInteraction is null/empty:", val);
        return;
      }
      this._processContactData(val, "activeInteraction");
    }

    // =================================================================
    // SETTER 4: $STORE.agentContact.outdialContactData
    // =================================================================
    set outdialData(val) {
      console.log("[WxccLastContactWidget] === SETTER: outdialData ===");
      if (!val || typeof val !== "object") {
        console.log("[WxccLastContactWidget] outdialData is null/empty:", val);
        return;
      }
      this._processContactData(val, "outdialData");
    }

    // =================================================================
    // SETTER 5: $STORE.agentContact.taskSelected (original)
    // =================================================================
    set interactionData(val) {
      console.log("[WxccLastContactWidget] === SETTER: interactionData ===");
      if (!val) {
        console.log("[WxccLastContactWidget] interactionData is null");
        if (!this._currentDnis) this._clearDisplay();
        return;
      }
      this._processContactData(val, "$STORE.taskSelected");
    }

    // =================================================================
    // SETTER 6: $STORE.agentContact.isActiveCall
    // =================================================================
    set isCallInProgress(val) {
      console.log("[WxccLastContactWidget] === SETTER: isCallInProgress ===", val);
      if (!val) {
        this._currentDnis = null;
        this._clearDisplay();
      }
    }

    // =================================================================
    // Central data processor — handles data from ANY source
    // =================================================================
    _processContactData(data, source) {
      if (!data || typeof data !== "object") {
        console.log(`[WxccLastContactWidget] [${source}] Data is empty/invalid`);
        return;
      }

      console.log(`[WxccLastContactWidget] [${source}] Processing contact data`);
      this._debugLogObject(`[${source}] data`, data);

      // Navigate to the interaction object
      const interaction = data.interaction || data.data?.interaction || data.data || data;
      if (interaction !== data) {
        this._debugLogObject(`[${source}] interaction`, interaction);
      }

      const cad = interaction.callAssociatedData || interaction.CAD || {};
      if (Object.keys(cad).length > 0) {
        this._debugLogObject(`[${source}] CAD`, cad);
      }

      const mediaProp = interaction.mediaProperties || data.mediaProperties || {};
      if (Object.keys(mediaProp).length > 0) {
        this._debugLogObject(`[${source}] mediaProperties`, mediaProp);
      }

      const cad2 = interaction.callAssociatedDetails || {};
      if (Object.keys(cad2).length > 0) {
        this._debugLogObject(`[${source}] callAssociatedDetails`, cad2);
      }

      // --- DNIS extraction from every known location ---
      const dnis =
        // CAD variables (.value objects)
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
        // CAD as direct strings
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
        // data top-level
        data.DNIS ||
        data.dnis ||
        data.dn ||
        data.DN ||
        data.ani ||
        data.ANI ||
        null;

      console.log(`[WxccLastContactWidget] [${source}] Resolved DNIS:`, dnis);

      if (dnis && dnis !== this._currentDnis) {
        this._currentDnis = dnis;
        this._setDnis(dnis);

        // ---------------------------------------------------------
        // CRM Lookup placeholder
        // Uncomment and update the URL to perform a CRM lookup.
        // ---------------------------------------------------------
        // fetch(`https://your-crm.example.com/api/lookup?dnis=${encodeURIComponent(dnis)}`)
        //   .then(response => response.json())
        //   .then(crmData => {
        //     if (crmData.lastContactDate) {
        //       // Update display with CRM data
        //     }
        //   })
        //   .catch(err => {
        //     console.error("[WxccLastContactWidget] CRM lookup failed:", err);
        //   });
        // ---------------------------------------------------------

      } else if (!dnis) {
        this._setNotFound();
      }
    }

    // =================================================================
    // Display helpers
    // =================================================================
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
  console.log("[WxccLastContactWidget] Registered successfully v8");
})();
