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
    .grid { display: grid; grid-template-columns: minmax(300px, 0.8fr) minmax(480px, 1.7fr); gap: 20px; align-items: start; }
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
      .grid { grid-template-columns: 1fr; }
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
  </main>

  <script>
    const terminalStatuses = new Set(["PASSED", "FAILED", "CANCELLED"]);
    const statusOrder = ["CREATED","VALIDATING","ALLOCATING","COMPILING","CONFIGURING","RUNNING","OBSERVING","ASSERTING","CLEANUP","PASSED"];
    let scenarios = [];
    let glEyeReady = false;
    let currentRunId = localStorage.getItem("testy.currentRunId") || "";
    let pollTimer;

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

    void refreshHealth();
    void loadScenarios();
    if (currentRunId) void refreshRun();
    setInterval(function () { void refreshHealth(); }, 3000);
  </script>
</body>
</html>`;
