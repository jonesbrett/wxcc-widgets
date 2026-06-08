// version10 - DNIS-only extraction (no ANI fallback)
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
      this._agentContactRef = null;
      this._taskMapRef = null;
      this._pollTimer = null;
      console.log("[WxccLastContactWidget] Constructor (v10)");
    }

    connectedCallback() {
      console.log("[WxccLastContactWidget] Mounted (v10)");
    }

    disconnectedCallback() {
      console.log("[WxccLastContactWidget] Removed from DOM");
      this._stopPolling();
    }

    // =================================================================
    // Debug helper
    // =================================================================
    _debugLogObject(label, obj) {
      if (!obj || typeof obj !== "object") {
        console.log(`[WXCC] ${label}:`, obj);
        return;
      }
      try {
        const keys = Object.keys(obj);
        console.log(`[WXCC] ${label} [${keys.length} keys]:`, keys);
        keys.forEach((k) => {
          const v = obj[k];
          if (v && typeof v === "object") {
            try {
              console.log(`[WXCC]   .${k} => [obj] keys:`, Object.keys(v));
            } catch (e) {
              console.log(`[WXCC]   .${k} => [obj] (keys unreadable)`);
            }
          } else {
            console.log(`[WXCC]   .${k} =>`, v);
          }
        });
      } catch (e) {
        console.log(`[WXCC] ${label}: keys failed (${e.message}), raw:`, obj);
      }
    }

    // =================================================================
    // Try MobX ObservableMap methods on a map-like object
    // =================================================================
    _tryReadMap(mapObj, label) {
      if (!mapObj) return [];
      const tasks = [];

      try { console.log(`[WXCC] ${label}.size =>`, mapObj.size); } catch (e) {}

      // .toJSON()
      try {
        if (typeof mapObj.toJSON === "function") {
          const json = mapObj.toJSON();
          console.log(`[WXCC] ${label}.toJSON():`, json);
          if (json && typeof json === "object") {
            Object.entries(json).forEach(([id, task]) => {
              tasks.push({ id, task });
            });
          }
        }
      } catch (e) {
        console.log(`[WXCC] ${label}.toJSON() failed: ${e.message}`);
      }

      // .forEach()
      try {
        if (typeof mapObj.forEach === "function") {
          mapObj.forEach((value, key) => {
            console.log(`[WXCC] ${label}.forEach => key: ${key}`, typeof value);
            tasks.push({ id: key, task: value });
          });
        }
      } catch (e) {
        console.log(`[WXCC] ${label}.forEach() failed: ${e.message}`);
      }

      // .entries()
      try {
        if (typeof mapObj.entries === "function") {
          const entries = mapObj.entries();
          for (const [key, value] of entries) {
            console.log(`[WXCC] ${label}.entries => key: ${key}`, typeof value);
            tasks.push({ id: key, task: value });
          }
        }
      } catch (e) {
        console.log(`[WXCC] ${label}.entries() failed: ${e.message}`);
      }

      // .values()
      try {
        if (typeof mapObj.values === "function") {
          const values = mapObj.values();
          let idx = 0;
          for (const value of values) {
            tasks.push({ id: `val_${idx}`, task: value });
            idx++;
          }
        }
      } catch (e) {
        console.log(`[WXCC] ${label}.values() failed: ${e.message}`);
      }

      // .keys() + .get()
      try {
        if (typeof mapObj.keys === "function") {
          const keys = mapObj.keys();
          const keyArr = [];
          for (const k of keys) { keyArr.push(k); }
          console.log(`[WXCC] ${label}.keys():`, keyArr);
          if (typeof mapObj.get === "function") {
            keyArr.forEach(k => {
              try {
                const val = mapObj.get(k);
                tasks.push({ id: k, task: val });
              } catch (e) {}
            });
          }
        }
      } catch (e) {
        console.log(`[WXCC] ${label}.keys() failed: ${e.message}`);
      }

      // Array.from()
      try {
        const arr = Array.from(mapObj);
        arr.forEach(entry => {
          if (Array.isArray(entry) && entry.length === 2) {
            tasks.push({ id: entry[0], task: entry[1] });
          }
        });
      } catch (e) {}

      // data_ (MobX internal)
      try {
        if (mapObj.data_ && typeof mapObj.data_ === "object") {
          if (mapObj.data_ instanceof Map) {
            mapObj.data_.forEach((value, key) => {
              const unwrapped = value?.value_ || value?.get?.() || value;
              tasks.push({ id: key, task: unwrapped });
            });
          }
        }
      } catch (e) {}

      return tasks;
    }

    // =================================================================
    // SETTER: $STORE.agentContact
    // =================================================================
    set agentContact(val) {
      if (!val || typeof val !== "object") return;
      this._agentContactRef = val;
      console.log("[WXCC] agentContact ref saved");
    }

    // =================================================================
    // SETTER: $STORE.agentContact.taskMap
    // =================================================================
    set taskMap(val) {
      console.log("[WXCC] === SETTER: taskMap ===");
      if (!val) return;
      this._taskMapRef = val;
      const tasks = this._tryReadMap(val, "taskMap");
      tasks.forEach(({ id, task }) => this._processTask(task, `taskMap.init["${id}"]`));
    }

    // =================================================================
    // SETTER: $STORE.agentContact.taskSelected
    // =================================================================
    set interactionData(val) {
      console.log("[WXCC] === SETTER: interactionData ===");
      if (!val) {
        if (!this._currentDnis) this._clearDisplay();
        return;
      }
      this._processTask(val, "interactionData");
    }

    // =================================================================
    // SETTER: $STORE.agentContact.taskSelected.interaction
    // =================================================================
    set activeInteraction(val) {
      console.log("[WXCC] === SETTER: activeInteraction ===");
      if (!val) return;
      this._processTask({ interaction: val }, "activeInteraction");
    }

    // =================================================================
    // SETTER: $STORE.agentContact.isActiveCall
    // =================================================================
    set isCallInProgress(val) {
      console.log("[WXCC] === isCallInProgress ===", val);
      if (val) {
        this._startPolling();
      } else {
        this._stopPolling();
        this._currentDnis = null;
        this._clearDisplay();
      }
    }

    // =================================================================
    // Poll for task data when call is active
    // =================================================================
    _startPolling() {
      if (this._pollTimer) return;
      let attempts = 0;
      const maxAttempts = 20;

      console.log("[WXCC] Starting poll for task data...");

      const poll = () => {
        attempts++;
        if (this._currentDnis) {
          console.log("[WXCC] DNIS found, stopping poll");
          this._stopPolling();
          return;
        }
        if (attempts > maxAttempts) {
          console.log("[WXCC] Max poll attempts reached");
          this._stopPolling();
          return;
        }

        console.log(`[WXCC] Poll attempt ${attempts}/${maxAttempts}`);

        const ac = this._agentContactRef;
        if (ac) {
          // taskSelected
          try {
            if (ac.taskSelected) {
              console.log("[WXCC] Poll: ac.taskSelected found!");
              this._processTask(ac.taskSelected, "poll.taskSelected");
            }
          } catch (e) {}

          // selectedTaskId
          try {
            const stid = ac.selectedTaskId;
            if (stid) console.log("[WXCC] Poll: selectedTaskId =>", stid);
          } catch (e) {}

          // taskMap
          try {
            const tm = ac.taskMap || this._taskMapRef;
            if (tm) {
              const tasks = this._tryReadMap(tm, `poll.taskMap[${attempts}]`);
              tasks.forEach(({ id, task }) => this._processTask(task, `poll.taskMap["${id}"]`));
            }
          } catch (e) {
            console.log("[WXCC] Poll taskMap read error:", e.message);
          }

          // Other possible properties
          try {
            const possibleKeys = [
              "outdialContactData", "previewContactData", "contactData",
              "currentContact", "activeContact", "campaignContact"
            ];
            possibleKeys.forEach(k => {
              try {
                if (ac[k]) {
                  console.log(`[WXCC] Poll: ac.${k} found!`);
                  this._processTask(ac[k], `poll.ac.${k}`);
                }
              } catch (e) {}
            });
          } catch (e) {}
        }
      };

      poll();
      this._pollTimer = setInterval(poll, 500);
    }

    _stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    }

    // =================================================================
    // Process a task object — DNIS-ONLY extraction (no ANI fallback)
    // =================================================================
    _processTask(task, source) {
      if (!task || typeof task !== "object") return;
      console.log(`[WXCC] [${source}] Processing task`);

      let dnis = null;

      try {
        const ix = task.interaction || task;

        // --- 1. CAD variables (highest priority for campaign DNIS) ---
        try {
          const cad = ix.callAssociatedData || ix.CAD || {};
          const cadKeys = Object.keys(cad);
          if (cadKeys.length > 0) {
            console.log(`[WXCC] [${source}] CAD keys:`, cadKeys);
            // DNIS-only CAD keys — strict order, no ANI
            const dnisLookups = [
              "DNIS", "dnis",
              "dn", "DN",
              "dialedNumber", "DialedNumber",
              "OutDialNumber", "outDialNumber", "outDial",
              "BN_NUMBER", "bn_number",
              "CampaignPhoneNumber", "campaignPhoneNumber",
              "destination", "Destination"
            ];
            for (const k of dnisLookups) {
              if (!dnis && cad[k]) {
                const v = typeof cad[k] === "object" ? cad[k].value : cad[k];
                if (v) { dnis = v; console.log(`[WXCC] [${source}] DNIS from CAD.${k}: ${v}`); break; }
              }
            }
          }
        } catch (e) {}

        // --- 2. callProcessingDetails (DNIS-only fields) ---
        try {
          const cpd = ix.callProcessingDetails;
          if (cpd && !dnis) {
            console.log(`[WXCC] [${source}] callProcessingDetails found`);
            dnis = cpd.dnis || cpd.DNIS || cpd.dialedNumber || cpd.outDialNumber ||
                   cpd.dn || cpd.DN || null;
            if (dnis) console.log(`[WXCC] [${source}] DNIS from CPD: ${dnis}`);
          }
        } catch (e) {}

        // --- 3. interaction-level properties (DNIS-only) ---
        if (!dnis) {
          dnis = ix.DNIS || ix.dnis || ix.dn || ix.DN ||
                 ix.dialedNumber || ix.outDialNumber || ix.destAgentAddress || null;
          if (dnis) console.log(`[WXCC] [${source}] DNIS from interaction: ${dnis}`);
        }

        // --- 4. mediaProperties (DNIS-only) ---
        try {
          const mp = ix.mediaProperties;
          if (mp && !dnis) {
            dnis = mp.DNIS || mp.dnis || mp.DN || mp.dn || null;
            if (dnis) console.log(`[WXCC] [${source}] DNIS from mediaProperties: ${dnis}`);
          }
        } catch (e) {}

      } catch (e) {
        console.log(`[WXCC] [${source}] interaction level error:`, e.message);
      }

      // --- 5. task top-level (DNIS-only) ---
      if (!dnis) {
        dnis = task.DNIS || task.dnis || task.dn || task.DN ||
               task.outDialNumber || task.dialNumber || task.destination || null;
        if (dnis) console.log(`[WXCC] [${source}] DNIS from task top-level: ${dnis}`);
      }

      console.log(`[WXCC] [${source}] Resolved DNIS:`, dnis);

      if (dnis && dnis !== this._currentDnis) {
        this._currentDnis = dnis;
        this._setDnis(dnis);
        this._stopPolling();

        // ---------------------------------------------------------
        // CRM Lookup placeholder
        // ---------------------------------------------------------
        // fetch(`https://your-crm.example.com/api/lookup?dnis=${encodeURIComponent(dnis)}`)
        //   .then(r => r.json())
        //   .then(data => { /* update display */ })
        //   .catch(err => console.error("[WXCC] CRM lookup failed:", err));
        // ---------------------------------------------------------
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
  console.log("[WxccLastContactWidget] Registered successfully v10");
})();
