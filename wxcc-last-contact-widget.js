// version13 - Fixed map reading + diagnostic logging
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

  // Poll intervals
  const POLL_FAST = 500;
  const POLL_SLOW = 2000;

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
      this._currentTaskId = null;
      this._agentContactRef = null;
      this._taskMapRef = null;
      this._pollTimer = null;
      this._pollRate = POLL_FAST;
      this._pollCount = 0;
      console.log("[WxccLastContactWidget] Constructor (v13)");
    }

    connectedCallback() {
      console.log("[WxccLastContactWidget] Mounted (v13)");
    }

    disconnectedCallback() {
      console.log("[WxccLastContactWidget] Removed from DOM");
      this._stopPolling();
    }

    // =================================================================
    // MobX ObservableMap reader — tries ALL methods, deduplicates
    // =================================================================
    _tryReadMap(mapObj, label) {
      if (!mapObj) return [];
      const taskMap = new Map(); // deduplicate by ID

      // .toJSON()
      try {
        if (typeof mapObj.toJSON === "function") {
          const json = mapObj.toJSON();
          if (json && typeof json === "object") {
            Object.entries(json).forEach(([id, task]) => { taskMap.set(id, task); });
          }
        }
      } catch (e) {}

      // .forEach()
      try {
        if (typeof mapObj.forEach === "function") {
          mapObj.forEach((value, key) => { taskMap.set(String(key), value); });
        }
      } catch (e) {}

      // .entries()
      try {
        if (typeof mapObj.entries === "function") {
          for (const [key, value] of mapObj.entries()) {
            taskMap.set(String(key), value);
          }
        }
      } catch (e) {}

      // .values()
      try {
        if (typeof mapObj.values === "function") {
          let idx = 0;
          for (const value of mapObj.values()) {
            if (!taskMap.has(String(idx))) taskMap.set(`val_${idx}`, value);
            idx++;
          }
        }
      } catch (e) {}

      // .keys() + .get()
      try {
        if (typeof mapObj.keys === "function" && typeof mapObj.get === "function") {
          for (const k of mapObj.keys()) {
            try { taskMap.set(String(k), mapObj.get(k)); } catch (e) {}
          }
        }
      } catch (e) {}

      // data_ (MobX internal)
      try {
        if (mapObj.data_ && mapObj.data_ instanceof Map) {
          mapObj.data_.forEach((value, key) => {
            const unwrapped = value?.value_ || value?.get?.() || value;
            taskMap.set(String(key), unwrapped);
          });
        }
      } catch (e) {}

      const tasks = [];
      taskMap.forEach((task, id) => { tasks.push({ id, task }); });
      return tasks;
    }

    // =================================================================
    // SETTERS
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

    set taskMap(val) {
      if (!val) return;
      this._taskMapRef = val;
      console.log("[WXCC] taskMap ref saved, type:", val?.constructor?.name);
      const tasks = this._tryReadMap(val, "taskMap.init");
      console.log("[WXCC] taskMap.init: found", tasks.length, "tasks");
      tasks.forEach(({ id, task }) => this._processTask(task, "taskMap.init", id));
    }

    set interactionData(val) {
      if (!val) {
        if (!this._currentDnis) this._clearDisplay();
        return;
      }
      this._processTask(val, "interactionData");
    }

    set activeInteraction(val) {
      if (!val) return;
      this._processTask({ interaction: val }, "activeInteraction");
    }

    set isCallInProgress(val) {
      console.log("[WXCC] isCallInProgress:", val);
      if (val) {
        this._startPolling();
      } else {
        this._stopPolling();
        this._currentDnis = null;
        this._currentTaskId = null;
        this._pollCount = 0;
        this._clearDisplay();
      }
    }

    // =================================================================
    // Polling — runs the entire time a call is active
    // =================================================================
    _startPolling() {
      if (this._pollTimer) return;
      this._pollRate = POLL_FAST;
      this._pollCount = 0;

      console.log("[WXCC] Polling started (fast mode)");
      this._runPollCycle();
      this._pollTimer = setInterval(() => this._runPollCycle(), this._pollRate);
    }

    _runPollCycle() {
      this._pollCount++;
      console.log(`[WXCC] Poll #${this._pollCount} (rate: ${this._pollRate}ms)`);

      const ac = this._agentContactRef;
      if (!ac) {
        console.log("[WXCC] No agentContact ref yet");
        return;
      }

      // --- Read all current tasks from taskMap ---
      let currentTasks = [];
      try {
        const tm = ac.taskMap || this._taskMapRef;
        if (tm) {
          currentTasks = this._tryReadMap(tm, "poll.taskMap");
          console.log(`[WXCC] Poll: ${currentTasks.length} task(s) found, IDs:`, currentTasks.map(t => t.id));
        } else {
          console.log("[WXCC] Poll: no taskMap available");
        }
      } catch (e) {
        console.log("[WXCC] Poll taskMap error:", e.message);
      }

      // --- Detect if previous task has disappeared (contact skipped) ---
      if (this._currentTaskId && currentTasks.length > 0) {
        const stillPresent = currentTasks.some(({ id }) => id === this._currentTaskId);
        if (!stillPresent) {
          console.log(`[WXCC] Task ${this._currentTaskId} gone — contact skipped, resetting`);
          this._currentDnis = null;
          this._currentTaskId = null;
          this._hideContactSection();
          this._dnisEl.textContent = "Loading...";
          this._dnisEl.className = "lc-value empty";
          this._wrapperEl.classList.remove("no-call");
          this._switchPollRate(POLL_FAST);
        }
      }

      // --- Process all current tasks ---
      currentTasks.forEach(({ id, task }) => {
        this._processTask(task, "poll.taskMap", id);
      });

      // --- Also try taskSelected ---
      try {
        if (ac.taskSelected) {
          console.log("[WXCC] Poll: taskSelected available");
          this._processTask(ac.taskSelected, "poll.taskSelected");
        }
      } catch (e) {}
    }

    _switchPollRate(newRate) {
      if (this._pollRate === newRate) return;
      this._pollRate = newRate;
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = setInterval(() => this._runPollCycle(), newRate);
      }
      console.log(`[WXCC] Poll rate -> ${newRate}ms`);
    }

    _stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
        console.log("[WXCC] Polling stopped");
      }
    }

    // =================================================================
    // Process a task — DNIS-ONLY extraction with task change detection
    // =================================================================
    _processTask(task, source, taskId = null) {
      if (!task || typeof task !== "object") return;

      // --- Detect task change ---
      if (taskId && this._currentTaskId && taskId !== this._currentTaskId) {
        console.log(`[WXCC] Task changed: ${this._currentTaskId} -> ${taskId}`);
        this._currentDnis = null;
        this._currentTaskId = taskId;
        this._hideContactSection();
        this._dnisEl.textContent = "Loading...";
        this._dnisEl.className = "lc-value empty";
        this._wrapperEl.classList.remove("no-call");
      }

      // --- Set task ID if first task ---
      if (taskId && !this._currentTaskId) {
        this._currentTaskId = taskId;
        console.log(`[WXCC] Task ID set: ${taskId}`);
      }

      // --- Skip if we already have DNIS for this task ---
      if (this._currentDnis) return;

      let dnis = null;

      try {
        const ix = task.interaction || task;

        // Log task and interaction keys for diagnostics
        try {
          console.log(`[WXCC] [${source}] task keys:`, Object.keys(task));
          if (ix !== task) {
            console.log(`[WXCC] [${source}] interaction keys:`, Object.keys(ix));
          }
        } catch (e) {}

        // 1. CAD variables
        try {
          const cad = ix.callAssociatedData || ix.CAD || {};
          const cadKeys = Object.keys(cad);
          if (cadKeys.length > 0) {
            console.log(`[WXCC] [${source}] CAD keys:`, cadKeys);
            // Log CAD values for debugging
            const cadEntries = cadKeys.map(k => {
              const v = cad[k];
              const val = typeof v === "object" ? v?.value : v;
              return `${k}=${val}`;
            });
            console.log(`[WXCC] [${source}] CAD values:`, cadEntries.join(", "));

            const dnisLookups = [
              "DNIS", "dnis", "dn", "DN", "dialedNumber", "DialedNumber",
              "OutDialNumber", "outDialNumber", "outDial", "BN_NUMBER", "bn_number",
              "CampaignPhoneNumber", "campaignPhoneNumber", "destination", "Destination"
            ];
            for (const k of dnisLookups) {
              if (!dnis && cad[k]) {
                const v = typeof cad[k] === "object" ? cad[k].value : cad[k];
                if (v) { dnis = v; console.log(`[WXCC] [${source}] DNIS from CAD.${k}: ${v}`); break; }
              }
            }
          } else {
            console.log(`[WXCC] [${source}] No CAD data`);
          }
        } catch (e) {}

        // 2. callProcessingDetails
        try {
          const cpd = ix.callProcessingDetails;
          if (cpd && !dnis) {
            console.log(`[WXCC] [${source}] CPD keys:`, Object.keys(cpd));
            dnis = cpd.dnis || cpd.DNIS || cpd.dialedNumber || cpd.outDialNumber ||
                   cpd.dn || cpd.DN || null;
            if (dnis) console.log(`[WXCC] [${source}] DNIS from CPD: ${dnis}`);
          }
        } catch (e) {}

        // 3. interaction-level
        if (!dnis) {
          dnis = ix.DNIS || ix.dnis || ix.dn || ix.DN ||
                 ix.dialedNumber || ix.outDialNumber || ix.destAgentAddress || null;
          if (dnis) console.log(`[WXCC] [${source}] DNIS from interaction: ${dnis}`);
        }

        // 4. mediaProperties
        try {
          const mp = ix.mediaProperties;
          if (mp && !dnis) {
            console.log(`[WXCC] [${source}] mediaProperties keys:`, Object.keys(mp));
            dnis = mp.DNIS || mp.dnis || mp.DN || mp.dn || null;
            if (dnis) console.log(`[WXCC] [${source}] DNIS from mediaProperties: ${dnis}`);
          }
        } catch (e) {}

      } catch (e) {}

      // 5. task top-level
      if (!dnis) {
        dnis = task.DNIS || task.dnis || task.dn || task.DN ||
               task.outDialNumber || task.dialNumber || task.destination || null;
        if (dnis) console.log(`[WXCC] [${source}] DNIS from task: ${dnis}`);
      }

      if (dnis) {
        console.log(`[WXCC] [${source}] DNIS resolved: ${dnis} (task: ${taskId || "?"})`);
        this._currentDnis = dnis;
        this._setDnis(dnis);
        this._switchPollRate(POLL_SLOW);
        this._performCrmLookup(dnis);
      } else {
        console.log(`[WXCC] [${source}] No DNIS found yet`);
      }
    }

    // =================================================================
    // Airtable CRM Lookup
    // =================================================================
    _performCrmLookup(dnis) {
      console.log("[WXCC] CRM lookup for:", dnis);

      this._showContactSection();
      this._contactEl.textContent = "Looking up...";
      this._contactEl.className = "lc-contact-loading";

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
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return resp.json();
        })
        .then(data => {
          console.log("[WXCC] CRM response:", JSON.stringify(data));

          if (!data.records || data.records.length === 0) {
            this._contactEl.textContent = "No record";
            this._contactEl.className = "lc-contact-none";
            return;
          }

          const fields = data.records[0].fields;
          const lastContactStr = fields.lastContact;
          console.log("[WXCC] lastContact:", lastContactStr);

          if (!lastContactStr) {
            this._contactEl.textContent = "Never contacted";
            this._contactEl.className = "lc-contact-none";
            return;
          }

          const lastContactDate = new Date(lastContactStr + "T00:00:00");
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const isToday = lastContactDate.getTime() === today.getTime();

          const formatted = lastContactDate.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric"
          });

          if (isToday) {
            this._contactEl.textContent = `${formatted} (Today)`;
            this._contactEl.className = "lc-contact-today";
          } else {
            this._contactEl.textContent = formatted;
            this._contactEl.className = "lc-contact-past";
          }
        })
        .catch(err => {
          console.error("[WXCC] CRM failed:", err);
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
  console.log("[WxccLastContactWidget] Registered successfully v13");
})();
