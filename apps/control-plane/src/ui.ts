import type { FastifyInstance } from "fastify";

export function registerControlPlaneUi(app: FastifyInstance): void {
  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(CONTROL_PLANE_HTML),
  );
}

const CONTROL_PLANE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Testy Control Plane</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f7f9;
      color: #15171a;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f6f7f9; }
    button, select { font: inherit; }
    .shell { max-width: 1320px; margin: 0 auto; padding: 28px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 28px; letter-spacing: -0.03em; }
    .sub { color: #6b7280; margin-top: 5px; font-size: 14px; }
    .health { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .badge { border-radius: 999px; padding: 7px 10px; font-size: 12px; font-weight: 700; border: 1px solid #d1d5db; background: white; }
    .badge.ok { color: #166534; background: #f0fdf4; border-color: #bbf7d0; }
    .badge.bad { color: #991b1b; background: #fef2f2; border-color: #fecaca; }
    .badge.warn { color: #92400e; background: #fffbeb; border-color: #fde68a; }
    .mode-switch { display:flex; gap:6px; margin:0 0 20px; padding:4px; width:max-content; background:#e9ecef; border-radius:11px; }
    .mode-button { border:0; background:transparent; color:#6b7280; padding:9px 14px; border-radius:8px; font-weight:800; cursor:pointer; }
    .mode-button.active { background:white; color:#111827; box-shadow:0 1px 2px rgba(0,0,0,.08); }
    .mode-view { display:none; }
    .mode-view.active { display:block; }
    .grid { display: grid; grid-template-columns: minmax(300px, 0.8fr) minmax(480px, 1.7fr); gap: 20px; align-items: start; }
    .demo-grid { display:grid; grid-template-columns:minmax(320px,.9fr) minmax(480px,1.5fr); gap:20px; align-items:start; }
    .field { display:grid; gap:6px; margin-bottom:14px; }
    .field label { font-size:12px; font-weight:800; color:#4b5563; }
    .field select { width:100%; border:1px solid #d1d5db; border-radius:9px; padding:9px 10px; background:white; }
    .demo-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
    .service-list { display:grid; gap:8px; }
    .service-row { display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid #f0f1f3; font-size:13px; }
    .demo-activity { max-height:360px; overflow:auto; }
    .demo-event { display:grid; grid-template-columns:92px 1fr; gap:10px; padding:8px 0; border-bottom:1px solid #f1f2f4; font-size:13px; }
    .result-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .result-cell { border:1px solid #eceef1; border-radius:10px; padding:11px; }
    .card { background: white; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 1px 2px rgba(0,0,0,.03); overflow: hidden; }
    .card-head { padding: 18px 20px; border-bottom: 1px solid #eef0f2; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .card-head h2 { margin: 0; font-size: 16px; }
    .card-body { padding: 18px 20px; }
    .scenario { padding: 14px 0; border-bottom: 1px solid #f0f1f3; }
    .scenario:last-child { border-bottom: 0; }
    .scenario-title { font-weight: 700; margin-bottom: 4px; }
    .meta { font-size: 12px; color: #6b7280; line-height: 1.5; }
    .btn { border: 0; border-radius: 9px; padding: 9px 13px; cursor: pointer; font-weight: 700; }
    .btn.primary { background: #111827; color: white; }
    .btn.secondary { background: #f3f4f6; color: #111827; }
    .btn.danger { background: #fee2e2; color: #991b1b; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    .scenario-actions { margin-top: 10px; display: flex; gap: 8px; }
    .empty { color: #6b7280; padding: 28px 0; text-align: center; }
    .run-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
    .metric { border: 1px solid #eceef1; border-radius: 11px; padding: 12px; }
    .metric .label { color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
    .metric .value { font-size: 18px; font-weight: 800; margin-top: 5px; }
    .status-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; border-radius: 11px; background: #f8fafc; margin-bottom: 16px; }
    .status { font-weight: 800; }
    .progress { height: 6px; background: #e5e7eb; border-radius: 99px; overflow: hidden; margin-bottom: 18px; }
    .progress > div { height: 100%; background: #111827; transition: width .25s ease; }
    .tabs { display: flex; gap: 6px; margin-bottom: 14px; border-bottom: 1px solid #eceef1; }
    .tab { border: 0; background: transparent; padding: 10px 8px; cursor: pointer; color: #6b7280; font-weight: 700; border-bottom: 2px solid transparent; }
    .tab.active { color: #111827; border-bottom-color: #111827; }
    .panel { display: none; }
    .panel.active { display: block; }
    .timeline { max-height: 390px; overflow: auto; }
    .event { display: grid; grid-template-columns: 92px 110px 1fr; gap: 10px; padding: 9px 0; border-bottom: 1px solid #f1f2f4; font-size: 13px; }
    .event .time, .event .cat { color: #6b7280; }
    .assertion { display: grid; grid-template-columns: 26px 1fr auto; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid #f1f2f4; font-size: 13px; }
    .pass { color: #15803d; font-weight: 900; }
    .fail { color: #b91c1c; font-weight: 900; }
    .provider { display: inline-flex; border-radius: 999px; background: #f3f4f6; padding: 5px 8px; margin: 4px 4px 0 0; font-size: 12px; }
    .error-box { white-space: pre-wrap; background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; border-radius: 10px; padding: 12px; margin-top: 12px; font-size: 12px; }
    .link { color: #1d4ed8; text-decoration: none; font-size: 13px; font-weight: 700; }
    @media (max-width: 900px) {
      .grid, .demo-grid { grid-template-columns: 1fr; }
      .run-summary { grid-template-columns: repeat(2, 1fr); }
      .topbar { align-items: flex-start; flex-direction: column; }
      .health { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>Testy Control Plane</h1>
        <div class="sub">Scenario-driven integration testing and evidence</div>
      </div>
      <div class="health">
        <span id="controlHealth" class="badge warn">Control Plane · checking</span>
        <span id="targetHealth" class="badge warn">Target · checking</span>
      </div>
    </header>

    <div class="mode-switch">
      <button id="automatedModeButton" class="mode-button active">Automated Tests</button>
      <button id="interactiveModeButton" class="mode-button">Interactive Demo</button>
    </div>

    <section id="automatedMode" class="mode-view active">
    <div class="grid">
      <section class="card">
        <div class="card-head">
          <h2>Scenarios</h2>
          <button class="btn secondary" id="refreshScenarios">Refresh</button>
        </div>
        <div class="card-body" id="scenarioList"><div class="empty">Loading scenarios…</div></div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Run console</h2>
          <div>
            <a id="htmlReportLink" class="link" href="#" target="_blank" hidden>Open HTML report</a>
          </div>
        </div>
        <div class="card-body">
          <div id="noRun" class="empty">Choose a scenario and press Run.</div>
          <div id="runConsole" hidden>
            <div class="status-line">
              <div>
                <div id="runScenario" style="font-weight:800"></div>
                <div id="runId" class="meta"></div>
              </div>
              <div style="display:flex;align-items:center;gap:10px">
                <span id="runStatus" class="badge warn"></span>
                <button id="cancelRun" class="btn danger">Cancel</button>
              </div>
            </div>
            <div class="progress"><div id="runProgress"></div></div>

            <div id="runMetrics" class="run-summary">
              <div class="metric"><div class="label">Assertions</div><div id="metricAssertions" class="value">—</div></div>
              <div class="metric"><div class="label">Provider calls</div><div id="metricProviders" class="value">—</div></div>
              <div class="metric"><div class="label">Browser actions</div><div id="metricBrowser" class="value">—</div></div>
              <div class="metric"><div class="label">Duration</div><div id="metricDuration" class="value">—</div></div>
            </div>

            <div class="tabs">
              <button class="tab active" data-panel="timelinePanel">Timeline</button>
              <button class="tab" data-panel="assertionsPanel">Assertions</button>
              <button class="tab" data-panel="providersPanel">Providers</button>
            </div>
            <div id="timelinePanel" class="panel active"><div id="timeline" class="timeline"></div></div>
            <div id="assertionsPanel" class="panel"><div id="assertions"></div></div>
            <div id="providersPanel" class="panel"><div id="providers"></div></div>
            <div id="runError" class="error-box" hidden></div>
          </div>
        </div>
      </section>
    </div>
    </section>

    <section id="interactiveMode" class="mode-view">
      <div class="demo-grid">
        <div>
          <section class="card">
            <div class="card-head">
              <h2>Interactive Demo</h2>
              <span id="demoStatus" class="badge warn">Not started</span>
            </div>
            <div class="card-body">
              <div class="meta" id="demoSessionMeta">Start a long-lived Testy session for manual browser QA.</div>
              <div id="demoVisitorControls" hidden style="margin-top:18px">
                <div class="field">
                  <label for="demoNetwork">Network identity</label>
                  <select id="demoNetwork"></select>
                </div>
                <div class="field">
                  <label for="demoPerson">Person</label>
                  <select id="demoPerson"></select>
                </div>
                <div class="field">
                  <label for="demoBrowser">Browser identity</label>
                  <select id="demoBrowser"></select>
                </div>
                <div id="demoIdentitySummary" class="meta"></div>
              </div>
              <div class="demo-actions">
                <button id="startDemo" class="btn primary">Start Demo</button>
                <button id="applyDemoVisitor" class="btn primary" hidden>Apply Visitor</button>
                <button id="openDemoWebsite" class="btn secondary" hidden>Open Demo Website</button>
                <button id="resetDemoVisitor" class="btn secondary" hidden>Reset Visitor</button>
                <button id="stopDemo" class="btn danger" hidden>Stop Demo</button>
              </div>
              <div id="demoError" class="error-box" hidden></div>
            </div>
          </section>

          <section class="card" style="margin-top:20px">
            <div class="card-head"><h2>Services</h2></div>
            <div class="card-body service-list">
              <div class="service-row"><span>GL-EYE</span><strong id="demoGlEyeService">Checking</strong></div>
              <div class="service-row"><span>GL-EYE workspace</span><strong>Testy Interactive Demo</strong></div>
              <div class="service-row"><span>Traffic Gateway</span><strong id="demoTrafficService">Session managed</strong></div>
              <div class="service-row"><span>IPInfo</span><strong>Mocked</strong></div>
              <div class="service-row"><span>Apollo</span><strong>Mocked</strong></div>
              <div class="service-row"><span>Hunter</span><strong>Mocked</strong></div>
            </div>
          </section>
        </div>

        <div>
          <section class="card">
            <div class="card-head">
              <h2>GL-EYE Result</h2>
              <button id="refreshDemoResult" class="btn secondary" hidden>Refresh GL-EYE Result</button>
            </div>
            <div class="card-body">
              <div id="demoResultEmpty" class="empty">Start a demo and browse the customer site to see the actual GL-EYE outcome. In the GL-EYE app, switch workspace from “GL-EYE Demo Company” to “Testy Interactive Demo” to inspect the same isolated tenant.</div>
              <div id="demoResult" class="result-grid" hidden>
                <div class="result-cell"><div class="meta">Company</div><strong id="demoCompanies">—</strong></div>
                <div class="result-cell"><div class="meta">Companies</div><strong id="demoCompanyCount">0</strong></div>
                <div class="result-cell"><div class="meta">Accepted events</div><strong id="demoProcessedEventCount">0</strong></div>
                <div class="result-cell"><div class="meta">Scores</div><strong id="demoScoreCount">0</strong></div>
                <div class="result-cell"><div class="meta">Confidence</div><strong id="demoConfidence">—</strong></div>
                <div class="result-cell"><div class="meta">Providers</div><strong id="demoProviders">—</strong></div>
              </div>
            </div>
          </section>

          <section class="card" style="margin-top:20px">
            <div class="card-head"><h2>Live Activity</h2></div>
            <div class="card-body">
              <div id="demoActivity" class="demo-activity"><div class="empty">No demo activity yet.</div></div>
            </div>
          </section>
        </div>
      </div>
    </section>
  </main>

  <script>
    const terminalStatuses = new Set(["PASSED", "FAILED", "CANCELLED"]);
    const statusOrder = ["CREATED","VALIDATING","ALLOCATING","COMPILING","CONFIGURING","RUNNING","OBSERVING","ASSERTING","CLEANUP","PASSED"];
    let scenarios = [];
    let glEyeReady = false;
    let currentRunId = localStorage.getItem("testy.currentRunId") || "";
    let pollTimer;
    let demoProfiles;
    let currentDemoId = localStorage.getItem("testy.currentDemoId") || "";
    let currentDemo;
    let demoPollTimer;
    let demoSelectorsSessionId = "";

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    async function requestJson(url, options) {
      const response = await fetch(url, options);
      const text = await response.text();
      let body;
      try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
      if (!response.ok) {
        const error = new Error(body.error || body.message || ("HTTP " + response.status));
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    }


    function setMode(mode) {
      const automated = mode === "automated";
      document.getElementById("automatedMode").classList.toggle("active", automated);
      document.getElementById("interactiveMode").classList.toggle("active", !automated);
      document.getElementById("automatedModeButton").classList.toggle("active", automated);
      document.getElementById("interactiveModeButton").classList.toggle("active", !automated);
      localStorage.setItem("testy.mode", mode);
      if (!automated) void loadDemoProfiles();
    }

    async function loadDemoProfiles() {
      if (demoProfiles) return demoProfiles;
      try {
        const result = await requestJson("/v1/demo-profiles");
        demoProfiles = result.profiles;
        renderDemoSelectors();
        return demoProfiles;
      } catch (error) {
        showDemoError("Unable to load visitor profiles: " + error.message);
        return undefined;
      }
    }

    function renderDemoSelectors(force) {
      if (!demoProfiles) return;
      if (!force && currentDemo?.id && demoSelectorsSessionId === currentDemo.id) return;
      const network = document.getElementById("demoNetwork");
      const browser = document.getElementById("demoBrowser");
      network.innerHTML = demoProfiles.networks.map(function (item) {
        return '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.displayName) + '</option>';
      }).join("");
      browser.innerHTML = demoProfiles.browserIdentities.map(function (item) {
        return '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.displayName) + '</option>';
      }).join("");
      network.value = currentDemo?.networkIdentityId || demoProfiles.defaults.networkId;
      browser.value = currentDemo?.browserIdentityId || demoProfiles.defaults.browserId;
      demoSelectorsSessionId = currentDemo?.id || "";
      renderDemoPeople();
    }

    function renderDemoPeople() {
      if (!demoProfiles) return;
      const networkId = document.getElementById("demoNetwork").value;
      const selectedNetwork = demoProfiles.networks.find(function (item) { return item.id === networkId; });
      const people = demoProfiles.people.filter(function (person) {
        return selectedNetwork?.companyId && person.companyId === selectedNetwork.companyId;
      });
      const select = document.getElementById("demoPerson");
      select.innerHTML = '<option value="">Anonymous / none</option>' + people.map(function (person) {
        return '<option value="' + escapeHtml(person.id) + '">' + escapeHtml(person.displayName) + '</option>';
      }).join("");
      const currentSelected = select.value;
      const desired = currentSelected || currentDemo?.personIdentityId || demoProfiles.defaults.personId;
      select.value = people.some(function (person) { return person.id === desired; })
        ? desired
        : (people[0]?.id || "");
      updateDemoIdentitySummary();
    }

    function updateDemoIdentitySummary() {
      if (!demoProfiles) return;
      const network = demoProfiles.networks.find(function (item) {
        return item.id === document.getElementById("demoNetwork").value;
      });
      const person = demoProfiles.people.find(function (item) {
        return item.id === document.getElementById("demoPerson").value;
      });
      const pieces = [];
      if (network) {
        pieces.push("Country: " + network.country);
        pieces.push("Synthetic IP: " + network.syntheticIp);
        pieces.push("Company: " + (network.companyName || "None"));
      }
      if (person) pieces.push("Person: " + person.name);
      document.getElementById("demoIdentitySummary").textContent = pieces.join(" · ");
    }

    async function startInteractiveDemo() {
      clearTimeout(demoPollTimer);
      document.getElementById("startDemo").disabled = true;
      showDemoError("");
      try {
        await loadDemoProfiles();
        currentDemoId = "";
        currentDemo = undefined;
        localStorage.removeItem("testy.currentDemoId");
        demoSelectorsSessionId = "";
        currentDemo = await requestJson("/v1/demo-sessions", { method: "POST" });
        currentDemoId = currentDemo.id;
        localStorage.setItem("testy.currentDemoId", currentDemoId);
        renderDemoSession();
        renderDemoSelectors(true);
        await refreshDemoActivity();
        scheduleDemoPoll();
      } catch (error) {
        showDemoError("Unable to start demo: " + error.message);
      } finally {
        document.getElementById("startDemo").disabled = false;
      }
    }

    async function refreshDemoSession() {
      if (!currentDemoId) return;
      try {
        currentDemo = await requestJson("/v1/demo-sessions/" + encodeURIComponent(currentDemoId));
        if (currentDemo.status === "FAILED" || currentDemo.status === "STOPPED") {
          currentDemoId = "";
          currentDemo = undefined;
          localStorage.removeItem("testy.currentDemoId");
          demoSelectorsSessionId = "";
          showDemoError("");
          renderDemoSession();
          return;
        }
        renderDemoSession();
        if (currentDemo.status === "READY" || currentDemo.status === "ACTIVE") {
          await refreshDemoActivity();
          await refreshDemoOutcome(false);
          scheduleDemoPoll();
        }
      } catch (error) {
        if (error.status === 404) {
          currentDemoId = "";
          currentDemo = undefined;
          localStorage.removeItem("testy.currentDemoId");
          renderDemoSession();
          return;
        }
        showDemoError("Unable to refresh demo: " + error.message);
      }
    }

    function renderDemoSession() {
      const active = currentDemo && (currentDemo.status === "READY" || currentDemo.status === "ACTIVE");
      const status = document.getElementById("demoStatus");
      if (!currentDemo) {
        setBadge(status, "Not started", "warn");
        document.getElementById("demoSessionMeta").textContent = "Start a long-lived Testy session for manual browser QA.";
      } else {
        setBadge(status, currentDemo.status, currentDemo.status === "FAILED" ? "bad" : currentDemo.status === "STOPPED" ? "warn" : "ok");
        document.getElementById("demoSessionMeta").textContent =
          "Session " + currentDemo.id + " · Started " + new Date(currentDemo.startedAt).toLocaleString();
      }
      document.getElementById("demoVisitorControls").hidden = !active;
      document.getElementById("applyDemoVisitor").hidden = !active;
      document.getElementById("openDemoWebsite").hidden = !active;
      document.getElementById("resetDemoVisitor").hidden = !active;
      document.getElementById("stopDemo").hidden = !active;
      document.getElementById("refreshDemoResult").hidden = !active;
      document.getElementById("startDemo").hidden = !!currentDemo && currentDemo.status !== "STOPPED" && currentDemo.status !== "FAILED";
      document.getElementById("demoGlEyeService").textContent = glEyeReady ? "Connected" : "Not ready";
      if (demoProfiles && active) renderDemoSelectors(false);
      if (currentDemo?.errorMessage) showDemoError(currentDemo.errorMessage);
    }

    async function applyDemoVisitorSelection() {
      if (!currentDemoId) return;
      const personId = document.getElementById("demoPerson").value;
      try {
        currentDemo = await requestJson("/v1/demo-sessions/" + encodeURIComponent(currentDemoId) + "/visitor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            networkId: document.getElementById("demoNetwork").value,
            ...(personId ? { personId: personId } : {}),
            browserId: document.getElementById("demoBrowser").value,
          }),
        });
        renderDemoSession();
        renderDemoSelectors(true);
        await refreshDemoActivity();
      } catch (error) {
        showDemoError("Unable to apply visitor: " + error.message);
      }
    }

    async function resetInteractiveVisitor() {
      if (!currentDemoId) return;
      try {
        currentDemo = await requestJson("/v1/demo-sessions/" + encodeURIComponent(currentDemoId) + "/reset-visitor", { method: "POST" });
        renderDemoSession();
        renderDemoSelectors(true);
        await refreshDemoActivity();
      } catch (error) {
        showDemoError("Unable to reset visitor: " + error.message);
      }
    }

    async function stopInteractiveDemo() {
      if (!currentDemoId) return;
      clearTimeout(demoPollTimer);
      try {
        currentDemo = await requestJson("/v1/demo-sessions/" + encodeURIComponent(currentDemoId), { method: "DELETE" });
        renderDemoSession();
      } catch (error) {
        showDemoError("Unable to stop demo: " + error.message);
      }
    }

    function openInteractiveWebsite() {
      if (currentDemo?.websiteUrl) window.open(currentDemo.websiteUrl, "_blank", "noopener");
    }

    async function refreshDemoOutcome(showErrors) {
      if (!currentDemoId || !currentDemo || !["READY","ACTIVE"].includes(currentDemo.status)) return;
      try {
        const result = await requestJson("/v1/demo-sessions/" + encodeURIComponent(currentDemoId) + "/outcome");
        const outcome = result.outcome || {};
        document.getElementById("demoResultEmpty").hidden = true;
        document.getElementById("demoResult").hidden = false;
        document.getElementById("demoCompanies").textContent =
          (outcome.companies || []).map(function (company) { return company.displayName; }).join(", ") || "—";
        document.getElementById("demoCompanyCount").textContent = String(outcome.companyCount ?? 0);
        document.getElementById("demoProcessedEventCount").textContent = String(outcome.processedEventCount ?? 0);
        document.getElementById("demoScoreCount").textContent = String(outcome.scoreCount ?? 0);
        document.getElementById("demoConfidence").textContent = outcome.confidence || "—";
        document.getElementById("demoProviders").textContent = (outcome.providerProvenance || []).join(", ") || "—";
      } catch (error) {
        if (showErrors) showDemoError("Unable to refresh GL-EYE result: " + error.message);
      }
    }

    async function refreshDemoActivity() {
      if (!currentDemoId || !currentDemo || !["READY","ACTIVE"].includes(currentDemo.status)) return;
      try {
        const result = await requestJson("/v1/demo-sessions/" + encodeURIComponent(currentDemoId) + "/activity");
        const events = [];
        (result.timeline || []).forEach(function (item) {
          events.push({ at: item.occurredAt, text: item.name });
        });
        (result.providerCalls || []).forEach(function (item) {
          events.push({ at: item.occurredAt, text: item.vendorId + " → " + (item.operationId || item.caseId || "provider call") });
        });
        (result.observations || []).forEach(function (item) {
          events.push({ at: item.observedAt, text: item.observationType + " · " + item.status });
        });
        (result.gatewayRequests || []).forEach(function (item) {
          events.push({
            at: item.occurredAt || new Date().toISOString(),
            text: "Traffic Gateway → " + (item.method || "request") + " · " + (item.outcome || "unknown") +
              (item.statusCode ? " · HTTP " + item.statusCode : "")
          });
        });
        (result.siteEvents || []).forEach(function (item) {
          events.push({
            at: new Date().toISOString(),
            text: item.type === "page-view"
              ? "Page viewed · " + (item.pageId || "page")
              : item.type === "form-submit"
                ? "Form submitted · " + (item.formId || "form")
                : item.type === "sdk-load"
                  ? "GL-EYE SDK " + (item.event || "load") + (item.value ? " · " + item.value : "")
                  : item.type === "tracking-forward"
                    ? "GL-EYE event " + (item.event || "forward") + (item.value ? " · " + item.value : "")
                    : "Site event · " + (item.type || "event")
          });
        });
        events.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
        document.getElementById("demoActivity").innerHTML = events.length
          ? events.slice(0, 80).map(function (event) {
              return '<div class="demo-event"><div class="time">' + escapeHtml(new Date(event.at).toLocaleTimeString()) +
                '</div><div>' + escapeHtml(event.text) + '</div></div>';
            }).join("")
          : '<div class="empty">No demo activity yet.</div>';
      } catch {}
    }

    function scheduleDemoPoll() {
      clearTimeout(demoPollTimer);
      demoPollTimer = setTimeout(function () { void refreshDemoSession(); }, 2500);
    }

    function showDemoError(message) {
      const box = document.getElementById("demoError");
      box.hidden = !message;
      box.textContent = message || "";
    }

    function setBadge(element, label, state) {
      element.textContent = label;
      element.className = "badge " + state;
    }

    async function refreshHealth() {
      const control = document.getElementById("controlHealth");
      const target = document.getElementById("targetHealth");
      try {
        await requestJson("/v1/readiness");
        setBadge(control, "Control Plane · ready", "ok");
      } catch {
        setBadge(control, "Control Plane · not ready", "bad");
      }
      try {
        const result = await requestJson("/v1/target-readiness");
        glEyeReady = result.status === "ready";
        setBadge(target, (result.target || "Target") + " · ready", "ok");
        target.title = result.contractVersion ? "Contract " + result.contractVersion : "";
      } catch (error) {
        glEyeReady = false;
        const detail = error.body || {};
        const code = detail.error ? " · " + detail.error : "";
        setBadge(target, (detail.target || "Target") + " · not ready" + code, "bad");
        target.title = "health=" + (detail.healthStatus ?? "?") + ", capabilities=" + (detail.capabilitiesStatus ?? "?");
      }
      updateScenarioAvailability();
    }

    function updateScenarioAvailability() {
      document.querySelectorAll(".run-scenario").forEach(function (button) {
        const blocked = button.dataset.target === "gl-eye" && !glEyeReady;
        button.disabled = blocked;
        button.title = blocked ? "GL-EYE target is not ready." : "";
        const scenario = button.closest(".scenario");
        const note = scenario ? scenario.querySelector(".target-readiness-note") : null;
        if (note) note.hidden = !blocked;
      });
    }

    async function loadScenarios() {
      const list = document.getElementById("scenarioList");
      try {
        const result = await requestJson("/v1/scenarios");
        scenarios = result.scenarios || [];
        if (scenarios.length === 0) {
          list.innerHTML = '<div class="empty">No scenarios found.</div>';
          return;
        }
        list.innerHTML = scenarios.map(function (scenario) {
          const blocked = scenario.target === "gl-eye" && !glEyeReady;
          return '<div class="scenario">' +
            '<div class="scenario-title">' + escapeHtml(scenario.displayName) + '</div>' +
            '<div class="meta">' + escapeHtml(scenario.scenarioId) + '<br>Target: ' + escapeHtml(scenario.target) + '</div>' +
            '<div class="meta target-readiness-note" ' + (blocked ? '' : 'hidden') + ' style="margin-top:6px;color:#b45309">GL-EYE target is not ready.</div>' +
            '<div class="scenario-actions"><button class="btn primary run-scenario" data-scenario="' + escapeHtml(scenario.scenarioId) +
              '" data-target="' + escapeHtml(scenario.target) + '"' + (blocked ? ' disabled' : '') + '>Run</button></div>' +
            '</div>';
        }).join("");
        document.querySelectorAll(".run-scenario").forEach(function (button) {
          button.addEventListener("click", function () { void startRun(button.dataset.scenario); });
        });
        updateScenarioAvailability();
      } catch (error) {
        list.innerHTML = '<div class="error-box">Unable to load scenarios: ' + escapeHtml(error.message) + '</div>';
      }
    }

    async function startRun(scenarioId) {
      const scenario = scenarios.find(function (candidate) { return candidate.scenarioId === scenarioId; });
      if (scenario && scenario.target === "gl-eye" && !glEyeReady) {
        alert("GL-EYE is not ready yet. Wait for the target badge to turn green before running this scenario.");
        return;
      }

      document.querySelectorAll(".run-scenario").forEach(function (button) { button.disabled = true; });
      try {
        const run = await requestJson("/v1/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scenarioId: scenarioId }),
        });
        currentRunId = run.id;
        localStorage.setItem("testy.currentRunId", currentRunId);
        await refreshRun();
      } catch (error) {
        alert("Unable to start run: " + error.message);
      } finally {
        updateScenarioAvailability();
      }
    }

    function statusClass(status) {
      if (status === "PASSED") return "ok";
      if (status === "FAILED" || status === "CANCELLED") return "bad";
      return "warn";
    }

    function progressFor(status) {
      if (status === "FAILED" || status === "CANCELLED") return 100;
      const index = statusOrder.indexOf(status);
      return index < 0 ? 5 : Math.max(5, Math.round(((index + 1) / statusOrder.length) * 100));
    }

    async function refreshRun() {
      if (!currentRunId) return;
      clearTimeout(pollTimer);
      try {
        const run = await requestJson("/v1/runs/" + encodeURIComponent(currentRunId));
        document.getElementById("noRun").hidden = true;
        document.getElementById("runConsole").hidden = false;
        document.getElementById("runScenario").textContent = run.scenarioId;
        document.getElementById("runId").textContent = run.id;
        const status = document.getElementById("runStatus");
        setBadge(status, run.status, statusClass(run.status));
        document.getElementById("runProgress").style.width = progressFor(run.status) + "%";
        document.getElementById("cancelRun").disabled = terminalStatuses.has(run.status) || run.status === "CLEANUP";

        await refreshTimeline(run.id);

        if (terminalStatuses.has(run.status)) {
          await refreshReport(run.id);
        } else {
          pollTimer = setTimeout(function () { void refreshRun(); }, 1000);
        }
      } catch (error) {
        document.getElementById("noRun").hidden = true;
        document.getElementById("runConsole").hidden = false;
        const box = document.getElementById("runError");
        box.hidden = false;
        box.textContent = "Unable to load run: " + error.message;
      }
    }

    async function refreshTimeline(runId) {
      try {
        const result = await requestJson("/v1/runs/" + encodeURIComponent(runId) + "/timeline");
        const events = result.events || [];
        document.getElementById("timeline").innerHTML = events.length
          ? events.slice().reverse().map(function (event) {
              const time = new Date(event.occurredAt).toLocaleTimeString();
              return '<div class="event"><div class="time">' + escapeHtml(time) + '</div><div class="cat">' +
                escapeHtml(event.category) + '</div><div><strong>' + escapeHtml(event.name) + '</strong></div></div>';
            }).join("")
          : '<div class="empty">No timeline events yet.</div>';
      } catch {}
    }

    async function refreshReport(runId) {
      try {
        const report = await requestJson("/v1/runs/" + encodeURIComponent(runId) + "/report");
        const summary = report.summary || {};
        document.getElementById("metricAssertions").textContent =
          String(summary.passedAssertions ?? 0) + "/" + String(summary.assertionCount ?? 0);
        document.getElementById("metricProviders").textContent = String(summary.providerCallCount ?? 0);
        document.getElementById("metricBrowser").textContent = String(summary.browserActionCount ?? 0);
        document.getElementById("metricDuration").textContent =
          summary.durationMs === undefined ? "—" : (Math.round(summary.durationMs / 100) / 10) + "s";

        const assertions = report.assertions || [];
        document.getElementById("assertions").innerHTML = assertions.length
          ? assertions.map(function (assertion) {
              return '<div class="assertion"><div class="' + (assertion.passed ? "pass" : "fail") + '">' +
                (assertion.passed ? "✓" : "×") + '</div><div><strong>' + escapeHtml(assertion.assertionId) +
                '</strong><div class="meta">' + escapeHtml(assertion.type) + '</div></div><div class="meta">' +
                escapeHtml(assertion.severity) + '</div></div>';
            }).join("")
          : '<div class="empty">No assertions recorded.</div>';

        const calls = report.providerCalls || [];
        const grouped = {};
        calls.forEach(function (call) { grouped[call.vendorId] = (grouped[call.vendorId] || 0) + 1; });
        document.getElementById("providers").innerHTML = Object.keys(grouped).length
          ? Object.keys(grouped).sort().map(function (vendor) {
              return '<span class="provider">' + escapeHtml(vendor) + ' · ' + grouped[vendor] + '</span>';
            }).join("")
          : '<div class="empty">No provider calls recorded.</div>';

        const reportLink = document.getElementById("htmlReportLink");
        reportLink.href = "/v1/runs/" + encodeURIComponent(runId) + "/report?format=html";
        reportLink.hidden = false;

        const errorBox = document.getElementById("runError");
        const executionError = report.run && report.run.metadata ? report.run.metadata.executionError : undefined;
        if (executionError) {
          errorBox.hidden = false;
          errorBox.textContent = String(executionError);
        } else {
          errorBox.hidden = true;
        }
      } catch (error) {
        const box = document.getElementById("runError");
        box.hidden = false;
        box.textContent = "Unable to load report: " + error.message;
      }
    }

    document.getElementById("automatedModeButton").addEventListener("click", function () { setMode("automated"); });
    document.getElementById("interactiveModeButton").addEventListener("click", function () { setMode("interactive"); });
    document.getElementById("startDemo").addEventListener("click", function () { void startInteractiveDemo(); });
    document.getElementById("applyDemoVisitor").addEventListener("click", function () { void applyDemoVisitorSelection(); });
    document.getElementById("openDemoWebsite").addEventListener("click", openInteractiveWebsite);
    document.getElementById("resetDemoVisitor").addEventListener("click", function () { void resetInteractiveVisitor(); });
    document.getElementById("stopDemo").addEventListener("click", function () { void stopInteractiveDemo(); });
    document.getElementById("refreshDemoResult").addEventListener("click", function () { void refreshDemoOutcome(true); });
    document.getElementById("demoNetwork").addEventListener("change", function () {
      renderDemoPeople();
      updateDemoIdentitySummary();
    });
    document.getElementById("demoPerson").addEventListener("change", updateDemoIdentitySummary);
    document.getElementById("demoBrowser").addEventListener("change", updateDemoIdentitySummary);

    document.getElementById("refreshScenarios").addEventListener("click", function () { void loadScenarios(); });
    document.getElementById("cancelRun").addEventListener("click", async function () {
      if (!currentRunId) return;
      try {
        await requestJson("/v1/runs/" + encodeURIComponent(currentRunId) + "/cancel", { method: "POST" });
        await refreshRun();
      } catch (error) {
        alert("Unable to cancel run: " + error.message);
      }
    });
    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".tab").forEach(function (candidate) { candidate.classList.remove("active"); });
        document.querySelectorAll(".panel").forEach(function (panel) { panel.classList.remove("active"); });
        tab.classList.add("active");
        document.getElementById(tab.dataset.panel).classList.add("active");
      });
    });

    setMode(localStorage.getItem("testy.mode") === "interactive" ? "interactive" : "automated");
    void refreshHealth();
    void loadScenarios();
    if (currentRunId) void refreshRun();
    if (currentDemoId) void refreshDemoSession();
    setInterval(function () { void refreshHealth(); }, 3000);
  </script>
</body>
</html>`;
