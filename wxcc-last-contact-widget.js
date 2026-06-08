// version9 - MobX ObservableMap aware DNIS extraction
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
      console.log("[WxccLastContactWidget] Constructor (v9)");
    }

    connectedCallback() {
      console.log("[WxccLastContactWidget] Mounted (v9)");
    }

    disconnectedCallback() {
      console.log("[WxccLastContactWidget] Removed from DOM");
      this._stopPolling();
    }

    // =================================================================
    // Debug helper — concise 2-level key dump
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

      // .size
      try {
        console.log(`[WXCC] ${label}.size =>`, mapObj.size);
      } catch (e) {}

      // .toJSON()
      try {
        if (typeof mapObj.toJSON === "function") {
          const json = mapObj.toJSON();
          console.log(`[WXCC] ${label}.toJSON():`, json);
          if (json && typeof json === "object") {
            Object.entries(json).forEach(([id, task]) => {
              console.log(`[WXCC] ${label}.toJSON task ${id}:`, typeof task);
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
            console.log(`[WXCC] ${label}.values[${idx}]:`, typeof value);
            tasks.push({ id: `val_${idx}`, task: value });
            idx++;
          }
        }
      } catch (e) {
        console.log(`[WXCC] ${label}.values() failed: ${e.message}`);
      }

      // .keys()
      try {
        if (typeof mapObj.keys === "function") {
          const keys = mapObj.keys();
          const keyArr = [];
          for (const k of keys) { keyArr.push(k); }
          console.log(`[WXCC] ${label}.keys():`, keyArr);
          // Try .get() for each key
          if (typeof mapObj.get === "function") {
            keyArr.forEach(k => {
              try {
                const val = mapObj.get(k);
                console.log(`[WXCC] ${label}.get("${k}"):`, typeof val);
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
        console.log(`[WXCC] Array.from(${label}):`, arr.length, "entries");
        arr.forEach(entry => {
          if (Array.isArray(entry) && entry.length === 2) {
            tasks.push({ id: entry[0], task: entry[1] });
          }
        });
      } catch (e) {
        console.log(`[WXCC] Array.from(${label}) failed: ${e.message}`);
      }

      // data_ (MobX internal)
      try {
        if (mapObj.data_ && typeof mapObj.data_ === "object") {
          console.log(`[WXCC] ${label}.data_ found, type:`, mapObj.data_.constructor?.name);
          if (mapObj.data_ instanceof Map) {
            mapObj.data_.forEach((value, key) => {
              console.log(`[WXCC] ${label}.data_ => key: ${key}`);
              // MobX stores ObservableValue wrappers — unwrap via .value_
              const unwrapped = value?.value_ || value?.get?.() || value;
              tasks.push({ id: key, task: unwrapped });
            });
          }
        }
      } catch (e) {
        console.log(`[WXCC] ${label}.data_ failed: ${e.message}`);
      }

      return tasks;
    }

    // =================================================================
    // SETTER: $STORE.agentContact (entire store)
    // =================================================================
    set agentContact(val) {
      if (!val || typeof val !== "object") return;
      this._agentContactRef = val;
      try {
        console.log("[WXCC] agentContact ref saved, keys:", Object.keys(val));
      } catch (e) {
        console.log("[WXCC] agentContact ref saved (keys unreadable)");
      }
    }

    // =================================================================
    // SETTER: $STORE.agentContact.taskMap
    // =================================================================
    set taskMap(val) {
      console.log("[WXCC] === SETTER: taskMap ===", val);
      if (!val) return;
      this._taskMapRef = val;
      console.log("[WXCC] taskMap type:", val?.constructor?.name);
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
      if (this._pollTimer) return; // already polling
      let attempts = 0;
      const maxAttempts = 20; // 10 seconds

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

        // --- Try agentContactRef ---
        const ac = this._agentContactRef;
        if (ac) {
          // taskSelected
          try {
            if (ac.taskSelected) {
              console.log("[WXCC] Poll: ac.taskSelected found!");
              this._debugLogObject("ac.taskSelected", ac.taskSelected);
              this._processTask(ac.taskSelected, "poll.taskSelected");
            }
          } catch (e) {}

          // selectedTaskId
          try {
            const stid = ac.selectedTaskId;
            if (stid) console.log("[WXCC] Poll: selectedTaskId =>", stid);
          } catch (e) {}

          // Try reading taskMap from the ref
          try {
            const tm = ac.taskMap || this._taskMapRef;
            if (tm) {
              const tasks = this._tryReadMap(tm, `poll.taskMap[${attempts}]`);
              tasks.forEach(({ id, task }) => this._processTask(task, `poll.taskMap["${id}"]`));
            }
          } catch (e) {
            console.log("[WXCC] Poll taskMap read error:", e.message);
          }

          // Try other agent contact properties
          try {
            const possibleKeys = [
              "outdialContactData", "previewContactData", "contactData",
              "currentContact", "activeContact", "campaignContact"
            ];
            possibleKeys.forEach(k => {
              try {
                if (ac[k]) {
                  console.log(`[WXCC] Poll: ac.${k} found!`);
                  this._debugLogObject(`ac.${k}`, ac[k]);
                  this._processTask(ac[k], `poll.ac.${k}`);
                }
              } catch (e) {}
            });
          } catch (e) {}
        }
      };

      // Run immediately, then every 500ms
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
    // Process a task object — deep DNIS extraction
    // =================================================================
    _processTask(task, source) {
      if (!task || typeof task !== "object") return;
      console.log(`[WXCC] [${source}] Processing task`);
      this._debugLogObject(`[${source}]`, task);

      let dnis = null;

      // --- interaction level ---
      try {
        const ix = task.interaction || task;

        // callProcessingDetails
        try {
          const cpd = ix.callProcessingDetails;
          if (cpd) {
            console.log(`[WXCC] [${source}] callProcessingDetails:`, cpd);
            dnis = dnis || cpd.dnis || cpd.DNIS || cpd.ani || cpd.ANI ||
                   cpd.dialedNumber || cpd.outDialNumber || cpd.dn || cpd.DN;
          }
        } catch (e) {}

        // callAssociatedData
        try {
          const cad = ix.callAssociatedData || ix.CAD || {};
          const cadKeys = Object.keys(cad);
          if (cadKeys.length > 0) {
            console.log(`[WXCC] [${source}] CAD keys:`, cadKeys);
            const cadLookups = [
              "DNIS", "dnis", "dn", "DN", "dialedNumber", "DialedNumber",
              "OutDialNumber", "outDialNumber", "outDial", "BN_NUMBER",
              "bn_number", "CampaignPhoneNumber", "campaignPhoneNumber",
              "phoneNumber", "PhoneNumber", "ani", "ANI",
              "destination", "Destination"
            ];
            for (const k of cadLookups) {
              if (!dnis && cad[k]) {
                const v = typeof cad[k] === "object" ? cad[k].value : cad[k];
                if (v) { dnis = v; console.log(`[WXCC] [${source}] DNIS from CAD.${k}: ${v}`); }
              }
            }
          }
        } catch (e) {}

        // mediaProperties
        try {
          const mp = ix.mediaProperties;
          if (mp) {
            console.log(`[WXCC] [${source}] mediaProperties:`, mp);
            dnis = dnis || mp.DNIS || mp.dnis || mp.DN || mp.dn || mp.ani || mp.ANI;
          }
        } catch (e) {}

        // participants
        try {
          const parts = ix.participants;
          if (parts && typeof parts === "object") {
            console.log(`[WXCC] [${source}] participants found`);
            const partEntries = Array.isArray(parts) ? parts : Object.values(parts);
            partEntries.forEach(p => {
              if (p) {
                console.log(`[WXCC] [${source}] participant:`, p.type || p.role, p.dn || p.id || p.number);
                if (!dnis && (p.type === "Customer" || p.role === "Customer")) {
                  dnis = p.dn || p.id || p.number || p.phoneNumber;
                }
              }
            });
          }
        } catch (e) {}

        // Direct interaction properties
        if (!dnis) {
          dnis = ix.DNIS || ix.dnis || ix.dn || ix.DN || ix.ani || ix.ANI ||
                 ix.destAgentAddress || ix.origin || ix.dialedNumber || ix.outDialNumber || null;
        }
      } catch (e) {
        console.log(`[WXCC] [${source}] interaction level error:`, e.message);
      }

      // --- task top-level ---
      if (!dnis) {
        dnis = task.DNIS || task.dnis || task.dn || task.DN || task.ani || task.ANI ||
               task.outDialNumber || task.dialNumber || task.destination || null;
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
      } else if (!dnis && !this._currentDnis) {
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
  console.log("[WxccLastContactWidget] Registered successfully v9");
})();
