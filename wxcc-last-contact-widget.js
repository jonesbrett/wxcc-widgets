// version11 - DNIS display + Airtable CRM lookup for Last Contact Date
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
      .lc-separator {
        color: #666;
        margin: 0 4px;
      }
      .lc-contact-today {
        color: #FF6B35;
        font-weight: 700;
      }
      .lc-contact-past {
        color: #07C160;
        font-weight: 600;
      }
      .lc-contact-none {
        color: #999;
        font-style: italic;
        font-weight: 400;
      }
      .lc-contact-loading {
        color: #999;
        font-style: italic;
        font-weight: 400;
      }
    </style>
    <div id="lc-wrapper" class="lc-wrapper no-call">
      <span class="lc-label">DNIS:</span>
      <span id="lc-dnis" class="lc-value empty">&mdash;</span>
      <span id="lc-separator" class="lc-separator" style="display:none;">|</span>
      <span id="lc-contact-label" class="lc-label" style="display:none;">Last Contact:</span>
      <span id="lc-contact" style="display:none;"></span>
    </div>
  `;

  // Airtable configuration
  const AIRTABLE_BASE = "appPmucupoffk2wmY";
  const AIRTABLE_TABLE = "Clients";
  const AIRTABLE_API_KEY = "patYqdB2ZUbYN9aCP.b3a72fd1165c7d269f81e802503859e13792dbd095447b34f3c60957ecbc68e8";
  const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}`;

  class WxccLastContactWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.shadowRoot.appendChild(template.content.cloneNode(true));
      this._dnisEl = this.shadowRoot.getElementById("lc-dnis");
      this._wrapperEl = this.shadowRoot.getElementById("lc-wrapper");
      this._separatorEl = this.shadowRoot.getElementById("lc-separator");
      this._contactLabelEl = this.shadowRoot.getElementById("lc-contact-label");
      this._contactEl = this.shadowRoot.getElementById("lc-contact");
      this._currentDnis = null;
      this._agentContactRef = null;
      this._taskMapRef = null;
      this._pollTimer = null;
      console.log("[WxccLastContactWidget] Constructor (v11)");
    }

    connectedCallback() {
      console.log("[WxccLastContactWidget] Mounted (v11)");
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
      } catch (e) {
        console.log(`[WXCC] ${label}: keys failed`, obj);
      }
    }

    // =================================================================
    // MobX ObservableMap reader
    // =================================================================
    _tryReadMap(mapObj, label) {
      if (!mapObj) return [];
      const tasks = [];

      try { console.log(`[WXCC] ${label}.size =>`, mapObj.size); } catch (e) {}

      try {
        if (typeof mapObj.toJSON === "function") {
          const json = mapObj.toJSON();
          if (json && typeof json === "object") {
            Object.entries(json).forEach(([id, task]) => { tasks.push({ id, task }); });
          }
        }
      } catch (e) {}

      try {
        if (typeof mapObj.forEach === "function") {
          mapObj.forEach((value, key) => { tasks.push({ id: key, task: value }); });
        }
      } catch (e) {}

      try {
        if (typeof mapObj.entries === "function") {
          for (const [key, value] of mapObj.entries()) {
            tasks.push({ id: key, task: value });
          }
        }
      } catch (e) {}

      try {
        if (typeof mapObj.values === "function") {
          let idx = 0;
          for (const value of mapObj.values()) {
            tasks.push({ id: `val_${idx}`, task: value });
            idx++;
          }
        }
      } catch (e) {}

      try {
        if (typeof mapObj.keys === "function" && typeof mapObj.get === "function") {
          const keyArr = [];
          for (const k of mapObj.keys()) { keyArr.push(k); }
          keyArr.forEach(k => {
            try { tasks.push({ id: k, task: mapObj.get(k) }); } catch (e) {}
          });
        }
      } catch (e) {}

      try {
        const arr = Array.from(mapObj);
        arr.forEach(entry => {
          if (Array.isArray(entry) && entry.length === 2) {
            tasks.push({ id: entry[0], task: entry[1] });
          }
        });
      } catch (e) {}

      try {
        if (mapObj.data_ && mapObj.data_ instanceof Map) {
          mapObj.data_.forEach((value, key) => {
            const unwrapped = value?.value_ || value?.get?.() || value;
            tasks.push({ id: key, task: unwrapped });
          });
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
          try {
            if (ac.taskSelected) {
              this._processTask(ac.taskSelected, "poll.taskSelected");
            }
          } catch (e) {}

          try {
            const tm = ac.taskMap || this._taskMapRef;
            if (tm) {
              const tasks = this._tryReadMap(tm, `poll.taskMap[${attempts}]`);
              tasks.forEach(({ id, task }) => this._processTask(task, `poll.taskMap["${id}"]`));
            }
          } catch (e) {}

          try {
            ["outdialContactData", "previewContactData", "contactData",
             "currentContact", "activeContact", "campaignContact"
            ].forEach(k => {
              try {
                if (ac[k]) { this._processTask(ac[k], `poll.ac.${k}`); }
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
    // Process a task — DNIS-ONLY extraction (no ANI)
    // =================================================================
    _processTask(task, source) {
      if (!task || typeof task !== "object") return;

      let dnis = null;

      try {
        const ix = task.interaction || task;

        // 1. CAD variables
        try {
          const cad = ix.callAssociatedData || ix.CAD || {};
          const cadKeys = Object.keys(cad);
          if (cadKeys.length > 0) {
            const dnisLookups = [
              "DNIS", "dnis", "dn", "DN", "dialedNumber", "DialedNumber",
              "OutDialNumber", "outDialNumber", "outDial", "BN_NUMBER", "bn_number",
              "CampaignPhoneNumber", "campaignPhoneNumber", "destination", "Destination"
            ];
            for (const k of dnisLookups) {
              if (!dnis && cad[k]) {
                const v = typeof cad[k] === "object" ? cad[k].value : cad[k];
                if (v) { dnis = v; break; }
              }
            }
          }
        } catch (e) {}

        // 2. callProcessingDetails
        try {
          const cpd = ix.callProcessingDetails;
          if (cpd && !dnis) {
            dnis = cpd.dnis || cpd.DNIS || cpd.dialedNumber || cpd.outDialNumber ||
                   cpd.dn || cpd.DN || null;
          }
        } catch (e) {}

        // 3. interaction-level
        if (!dnis) {
          dnis = ix.DNIS || ix.dnis || ix.dn || ix.DN ||
                 ix.dialedNumber || ix.outDialNumber || ix.destAgentAddress || null;
        }

        // 4. mediaProperties
        try {
          const mp = ix.mediaProperties;
          if (mp && !dnis) {
            dnis = mp.DNIS || mp.dnis || mp.DN || mp.dn || null;
          }
        } catch (e) {}

      } catch (e) {}

      // 5. task top-level
      if (!dnis) {
        dnis = task.DNIS || task.dnis || task.dn || task.DN ||
               task.outDialNumber || task.dialNumber || task.destination || null;
      }

      if (dnis && dnis !== this._currentDnis) {
        console.log(`[WXCC] [${source}] DNIS found: ${dnis}`);
        this._currentDnis = dnis;
        this._setDnis(dnis);
        this._stopPolling();
        this._performCrmLookup(dnis);
      }
    }

    // =================================================================
    // Airtable CRM Lookup
    // =================================================================
    _performCrmLookup(dnis) {
      console.log("[WXCC] Starting CRM lookup for DNIS:", dnis);

      // Show loading state
      this._showContactSection();
      this._contactEl.textContent = "Looking up...";
      this._contactEl.className = "lc-contact-loading";

      // Build Airtable filter URL
      const filter = `{phoneNumber} = '${dnis}'`;
      const params = new URLSearchParams({ filterByFormula: filter });
      const url = `${AIRTABLE_URL}?${params.toString()}`;

      console.log("[WXCC] CRM URL:", url);

      fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json"
        }
      })
        .then(resp => {
          console.log("[WXCC] CRM response status:", resp.status);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return resp.json();
        })
        .then(data => {
          console.log("[WXCC] CRM response:", JSON.stringify(data));

          if (!data.records || data.records.length === 0) {
            console.log("[WXCC] No CRM record found for DNIS:", dnis);
            this._contactEl.textContent = "No record";
            this._contactEl.className = "lc-contact-none";
            return;
          }

          const fields = data.records[0].fields;
          const lastContactStr = fields.lastContact;
          console.log("[WXCC] lastContact field:", lastContactStr);

          if (!lastContactStr) {
            this._contactEl.textContent = "Never contacted";
            this._contactEl.className = "lc-contact-none";
            return;
          }

          // Parse and format the date
          const lastContactDate = new Date(lastContactStr + "T00:00:00");
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const isToday = lastContactDate.getTime() === today.getTime();

          // Format: "04 Jun 2026"
          const formatted = lastContactDate.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric"
          });

          if (isToday) {
            this._contactEl.textContent = `${formatted} (Today)`;
            this._contactEl.className = "lc-contact-today";
            console.log("[WXCC] Contact was TODAY");
          } else {
            this._contactEl.textContent = formatted;
            this._contactEl.className = "lc-contact-past";
            console.log("[WXCC] Last contact:", formatted);
          }
        })
        .catch(err => {
          console.error("[WXCC] CRM lookup failed:", err);
          this._contactEl.textContent = "Lookup failed";
          this._contactEl.className = "lc-contact-none";
        });
    }

    // =================================================================
    // Display helpers
    // =================================================================
    _setDnis(dnis) {
      this._dnisEl.textContent = dnis;
      this._dnisEl.className = "lc-value highlight";
      this._wrapperEl.classList.remove("no-call");
    }

    _showContactSection() {
      this._separatorEl.style.display = "";
      this._contactLabelEl.style.display = "";
      this._contactEl.style.display = "";
    }

    _hideContactSection() {
      this._separatorEl.style.display = "none";
      this._contactLabelEl.style.display = "none";
      this._contactEl.style.display = "none";
      this._contactEl.textContent = "";
    }

    _clearDisplay() {
      this._dnisEl.textContent = "\u2014";
      this._dnisEl.className = "lc-value empty";
      this._wrapperEl.classList.add("no-call");
      this._hideContactSection();
    }
  }

  customElements.define("wxcc-last-contact-widget", WxccLastContactWidget);
  console.log("[WxccLastContactWidget] Registered successfully v11");
})();
