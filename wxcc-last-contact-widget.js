// version7 - WxCC Desktop SDK event-driven DNIS extraction
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
      this._sdkPollTimer = null;
      this._sdkReady = false;
      this._currentDnis = null;
      console.log("[WxccLastContactWidget] Constructor called (v7)");
    }

    connectedCallback() {
      console.log("[WxccLastContactWidget] Mounted to DOM (v7)");
      this._startSDKDiscovery();
    }

    disconnectedCallback() {
      console.log("[WxccLastContactWidget] Removed from DOM");
      if (this._sdkPollTimer) {
        clearInterval(this._sdkPollTimer);
        this._sdkPollTimer = null;
      }
    }

    // =================================================================
    // SDK Discovery — poll until Desktop SDK is available
    // =================================================================
    _startSDKDiscovery() {
      let attempts = 0;
      const maxAttempts = 60; // 30 seconds at 500ms intervals

      this._sdkPollTimer = setInterval(() => {
        attempts++;
        if (this._sdkReady) {
          clearInterval(this._sdkPollTimer);
          this._sdkPollTimer = null;
          return;
        }

        if (attempts > maxAttempts) {
          console.warn("[WxccLastContactWidget] SDK not found after 30s — giving up polling");
          clearInterval(this._sdkPollTimer);
          this._sdkPollTimer = null;
          return;
        }

        // Check for Desktop SDK
        if (window.Desktop) {
          console.log("[WxccLastContactWidget] Desktop SDK found on attempt", attempts);
          clearInterval(this._sdkPollTimer);
          this._sdkPollTimer = null;
          this._sdkReady = true;
          this._initSDK();
        }
      }, 500);
    }

    _initSDK() {
      this._discoverSDK();

      // Initialize the SDK config if possible
      try {
        if (window.Desktop.config && typeof window.Desktop.config.init === "function") {
          window.Desktop.config.init({
            widgetName: "wxcc-last-contact-widget",
            widgetProvider: "custom"
          });
          console.log("[WxccLastContactWidget] Desktop.config.init() called");
        }
      } catch (e) {
        console.warn("[WxccLastContactWidget] Desktop.config.init() failed:", e.message);
      }

      this._subscribeToEvents();
    }

    // =================================================================
    // Discover and log all available SDK modules
    // =================================================================
    _discoverSDK() {
      try {
        const D = window.Desktop;
        console.log("[WxccLastContactWidget] Desktop keys:", Object.keys(D));

        if (D.agentContact) {
          const ac = D.agentContact;
          console.log("[WxccLastContactWidget] Desktop.agentContact keys:", Object.keys(ac));
          // Log methods vs properties
          Object.keys(ac).forEach(k => {
            console.log(`[WxccLastContactWidget]   agentContact.${k} => [${typeof ac[k]}]`);
          });
        } else {
          console.log("[WxccLastContactWidget] Desktop.agentContact is not available");
        }

        if (D.agentStateInfo) {
          console.log("[WxccLastContactWidget] Desktop.agentStateInfo keys:", Object.keys(D.agentStateInfo));
        }

        if (D.dialer) {
          console.log("[WxccLastContactWidget] Desktop.dialer keys:", Object.keys(D.dialer));
        }

        if (D.screenpop) {
          console.log("[WxccLastContactWidget] Desktop.screenpop keys:", Object.keys(D.screenpop));
        }
      } catch (e) {
        console.warn("[WxccLastContactWidget] SDK discovery error:", e.message);
      }
    }

    // =================================================================
    // Subscribe to all relevant Desktop SDK events
    // =================================================================
    _subscribeToEvents() {
      const ac = window.Desktop?.agentContact;
      if (!ac) {
        console.warn("[WxccLastContactWidget] Desktop.agentContact unavailable — cannot subscribe");
        return;
      }

      // List of event methods to try subscribing to
      const events = [
        { name: "addEventListener", eventName: "eAgentContact" },
        { name: "addEventListener", eventName: "eAgentOfferContact" },
        { name: "addEventListener", eventName: "eAgentContactAssigned" },
        { name: "addEventListener", eventName: "eCallDataChanged" },
        { name: "addEventListener", eventName: "eAgentContactEnded" },
        { name: "addEventListener", eventName: "eAgentOfferConsult" },
        { name: "addEventListener", eventName: "eAgentWrapup" },
        { name: "addEventListener", eventName: "eAgentContactHeld" },
        { name: "addEventListener", eventName: "eAgentContactUnHeld" }
      ];

      events.forEach(evt => {
        try {
          if (typeof ac.addEventListener === "function") {
            ac.addEventListener(evt.eventName, (data) => {
              console.log(`[WxccLastContactWidget] SDK Event: ${evt.eventName}`, data);
              this._processContactData(data, evt.eventName);
            });
            console.log(`[WxccLastContactWidget] Subscribed to: ${evt.eventName}`);
          }
        } catch (e) {
          console.log(`[WxccLastContactWidget] Could not subscribe to ${evt.eventName}:`, e.message);
        }
      });

      // Also try the onChange pattern if addEventListener doesn't exist
      if (typeof ac.addEventListener !== "function") {
        console.log("[WxccLastContactWidget] No addEventListener — trying onChange patterns");
        try {
          if (typeof ac.onChange === "function") {
            ac.onChange((data) => {
              console.log("[WxccLastContactWidget] agentContact.onChange:", data);
              this._processContactData(data, "onChange");
            });
            console.log("[WxccLastContactWidget] Subscribed to agentContact.onChange");
          }
        } catch (e) {
          console.log("[WxccLastContactWidget] onChange not available:", e.message);
        }
      }

      // Try to read any existing task data right now
      this._probeExistingTasks();
    }

    // =================================================================
    // Probe for any already-active tasks (e.g. page reloaded mid-call)
    // =================================================================
    _probeExistingTasks() {
      const ac = window.Desktop?.agentContact;
      if (!ac) return;

      // Try getTaskMap
      try {
        if (typeof ac.getTaskMap === "function") {
          const taskMap = ac.getTaskMap();
          console.log("[WxccLastContactWidget] getTaskMap():", taskMap);
          if (taskMap && typeof taskMap === "object") {
            const entries = taskMap instanceof Map ? [...taskMap.entries()] : Object.entries(taskMap);
            entries.forEach(([id, task]) => {
              console.log(`[WxccLastContactWidget] Existing task ${id}:`, task);
              this._processContactData(task, "getTaskMap");
            });
          }
        }
      } catch (e) {
        console.log("[WxccLastContactWidget] getTaskMap() failed:", e.message);
      }

      // Try getTask
      try {
        if (typeof ac.getTask === "function") {
          const task = ac.getTask();
          console.log("[WxccLastContactWidget] getTask():", task);
          if (task) this._processContactData(task, "getTask");
        }
      } catch (e) {
        console.log("[WxccLastContactWidget] getTask() failed:", e.message);
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

      // Navigate to the interaction object (could be nested in various ways)
      const interaction = data.interaction || data.data?.interaction || data.data || data;
      this._debugLogObject(`[${source}] interaction`, interaction);

      const cad = interaction.callAssociatedData || interaction.CAD || {};
      this._debugLogObject(`[${source}] CAD`, cad);

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
    // $STORE property setters (fallback — kept for compatibility)
    // =================================================================
    set interactionData(val) {
      console.log("[WxccLastContactWidget] === $STORE interactionData setter ===");
      if (!val) {
        console.log("[WxccLastContactWidget] $STORE val is null — no active task");
        if (!this._currentDnis) this._clearDisplay();
        return;
      }
      this._processContactData(val, "$STORE.taskSelected");
    }

    set isCallInProgress(val) {
      console.log("[WxccLastContactWidget] isCallInProgress:", val);
      if (val && !this._currentDnis) {
        // Call started but no DNIS yet — try probing SDK
        console.log("[WxccLastContactWidget] Call active, probing SDK for task data...");
        setTimeout(() => this._probeExistingTasks(), 500);
        setTimeout(() => this._probeExistingTasks(), 1500);
        setTimeout(() => this._probeExistingTasks(), 3000);
      }
      if (!val) {
        this._currentDnis = null;
        this._clearDisplay();
      }
    }

    // =================================================================
    // Debug helper
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
          console.log(`[WxccLastContactWidget]   ${label}.${k} => [${type}] keys:`, Object.keys(v));
        } else {
          console.log(`[WxccLastContactWidget]   ${label}.${k} => [${type}]`, v);
        }
      });
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
  console.log("[WxccLastContactWidget] Registered successfully v7");
})();
