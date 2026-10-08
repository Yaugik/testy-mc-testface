import type { FastifyInstance } from "fastify";

import { isDemoDiagnostic, visitorSelectionChanged } from "./ui-state.js";

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
    :root { color-scheme:light; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; --ink:#202c40; --muted:#627086; --line:#e1e6ee; --accent:#3159d5; --surface:#fff; --soft:#f4f6fa; color:var(--ink); background:#f6f7fa; }
    * { box-sizing:border-box; }
    [hidden] { display:none!important; }
    body { margin:0; }
    button,input,select { font:inherit; }
    button,a { -webkit-tap-highlight-color:transparent; }
    button { cursor:pointer; }
    button:disabled { cursor:not-allowed; opacity:.5; }
    button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible { outline:3px solid #3159d56b; outline-offset:3px; }
    .shell { max-width:1640px; margin:0 auto; padding:0 28px 40px; }
    .topbar { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:20px 0; }
    .brand { display:flex; gap:11px; align-items:center; }
    .brand-logo { width:34px; height:34px; border-radius:9px; display:grid; place-items:center; background:var(--ink); color:#fff; font-size:17px; font-weight:800; }
    h1 { font-size:21px; letter-spacing:-.035em; margin:0; }
    h2 { margin:0; font-size:16px; letter-spacing:-.015em; }
    .sub,.heading-description { color:var(--muted); font-size:12px; margin-top:3px; line-height:1.5; }
    .health { display:flex; gap:8px; flex-wrap:wrap; }
    .badge { display:inline-flex; gap:6px; align-items:center; border-radius:5px; padding:5px 8px; font-size:11px; font-weight:650; background:var(--soft); color:var(--muted); white-space:nowrap; }
    .badge:before { content:""; width:5px; height:5px; border-radius:50%; background:currentColor; }
    .badge.ok { background:#edf7f1; color:#26724c; }
    .badge.bad { background:#fff0ee; color:#b42318; }
    .badge.warn { background:#fff6e7; color:#8a5616; }
    .mode-switch { display:flex; gap:24px; border-bottom:1px solid var(--line); }
    .mode-button { background:none; border:0; border-bottom:2px solid transparent; padding:11px 0; color:var(--muted); font-size:13px; font-weight:650; }
    .mode-button.active { color:var(--accent); border-bottom-color:var(--accent); }
    .mode-view { display:none; }
    .mode-view.active { display:block; }
    .context-banner { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:20px 0; }
    .context-banner h2 { font-size:20px; letter-spacing:-.025em; }
    .context-banner p { margin:4px 0 0; color:var(--muted); font-size:13px; }
    .live-caption { font-size:12px; color:var(--muted); display:flex; gap:7px; align-items:center; white-space:nowrap; }
    .live-dot { background:#29945d; width:6px; height:6px; border-radius:50%; }
    .grid { display:grid; grid-template-columns:minmax(300px,.8fr) minmax(0,1.3fr); gap:20px; align-items:start; }
    .interactive-workspace { display:grid; grid-template-columns:244px minmax(0,1fr); gap:22px; align-items:start; }
    .demo-grid { display:grid; grid-template-columns:minmax(280px,.85fr) minmax(0,1.15fr); gap:18px; align-items:start; }
    .card { background:var(--surface); border:1px solid var(--line); border-radius:10px; min-width:0; overflow:hidden; }
    .card-head { padding:16px 18px; display:flex; justify-content:space-between; align-items:center; gap:12px; border-bottom:1px solid var(--line); }
    .card-body { padding:18px; }
    .toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; min-width:0; }
    .search-input,.field select,.confirm-input { width:100%; min-width:0; background:#fff; color:var(--ink); border:1px solid #cdd5e1; border-radius:7px; padding:9px 10px; font-size:13px; }
    .search-input { max-width:220px; }
    .btn { display:inline-flex; justify-content:center; align-items:center; gap:6px; border:1px solid var(--line); border-radius:7px; padding:9px 12px; background:#fff; color:var(--ink); font-size:13px; font-weight:650; line-height:1.35; }
    .btn:hover:not(:disabled) { background:var(--soft); }
    .btn.primary { background:var(--accent); border-color:var(--accent); color:white; }
    .btn.primary:hover:not(:disabled) { background:#2446b4; }
    .btn.secondary { background:#fff; }
    .btn.danger { color:#b42318; border-color:#efc9c5; background:#fff7f6; }
    .text-button { border:0; padding:2px 0; font-size:12px; font-weight:600; color:var(--accent); background:none; }
    .meta { font-size:12px; line-height:1.5; color:var(--muted); }
    .session-sidebar { position:sticky; top:18px; }
    .session-sidebar .card-head { padding:15px; }
    .session-sidebar .card-body { padding:12px; }
    .session-sidebar .toolbar { flex-wrap:nowrap; margin-bottom:12px; }
    .session-sidebar .search-input { max-width:none; }
    .session-sidebar .toolbar .btn { padding:9px; }
    .new-session-button { width:100%; margin-bottom:14px; }
    .demo-session-tabs { display:flex; gap:16px; margin:0 0 14px; border-bottom:1px solid var(--line); }
    .demo-session-tab { padding:8px 0; border:0; border-bottom:2px solid transparent; background:none; color:var(--muted); font-size:12px; font-weight:600; }
    .demo-session-tab.active { color:var(--accent); border-bottom-color:var(--accent); }
    .demo-session-list { display:grid; gap:6px; max-height:calc(100vh - 360px); min-height:110px; overflow:auto; }
    .demo-session-item { width:100%; text-align:left; border:1px solid transparent; border-radius:7px; background:#fff; color:var(--ink); padding:12px; }
    .demo-session-item:hover { background:var(--soft); }
    .demo-session-item.selected { border-color:#cedbff; background:#eef3ff; }
    .demo-session-item strong { display:block; font-size:13px; overflow-wrap:anywhere; line-height:1.45; }
    .demo-session-item .meta { display:block; overflow-wrap:anywhere; margin:4px 0; }
    .session-meta-row { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:7px; }
    .session-meta-row .badge { font-size:10px; padding:3px 5px; }
    .session-shared-note { margin:14px 3px 2px; font-size:11px; line-height:1.55; color:var(--muted); }
    .workspace-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin:0 0 16px; }
    .workspace-heading h2 { font-size:16px; overflow-wrap:anywhere; }
    .workspace-heading .meta { margin-top:4px; }
    .stage-label { color:var(--muted); font-size:10px; font-weight:650; text-transform:uppercase; letter-spacing:.08em; margin-bottom:5px; }
    .field { display:grid; gap:6px; margin:0 0 15px; }
    .field label { font-size:12px; font-weight:600; color:#4d5c71; }
    .identity-summary { padding:0 0 15px; line-height:1.6; }
    .visitor-primary-actions { display:grid; grid-template-columns:1fr; gap:8px; }
    .visitor-feedback { font-size:12px; color:var(--muted); line-height:1.5; margin:10px 0 0; }
    .visitor-feedback.pending { color:#8a5616; }
    .visitor-secondary-actions { display:flex; margin:14px 0 0; }
    .workspace-details { border-top:1px solid var(--line); margin-top:18px; padding-top:14px; }
    summary { cursor:pointer; font-size:12px; font-weight:650; color:#465570; }
    .workspace-details[open] summary { margin-bottom:14px; }
    .result-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px 14px; }
    .result-cell { min-width:0; }
    .result-cell strong { display:block; font-size:18px; margin-top:4px; overflow-wrap:anywhere; }
    .result-cell.company { grid-column:1/-1; padding-bottom:14px; border-bottom:1px solid var(--line); }
    .result-cell.company strong { font-size:22px; letter-spacing:-.025em; }
    .credential-grid strong { font-size:12px; font-weight:600; }
    .cell-actions { display:flex; gap:10px; align-items:center; margin-top:7px; }
    .session-id { font-size:11px; overflow-wrap:anywhere; color:var(--muted); }
    .session-controls { border-top:1px solid var(--line); padding-top:14px; margin-top:14px; }
    .demo-actions { display:flex; gap:8px; flex-wrap:wrap; }
    .danger-zone { margin-top:12px; }
    .service-list { display:grid; gap:7px; margin-top:12px; }
    .service-row { display:flex; gap:12px; justify-content:space-between; font-size:12px; color:var(--muted); }
    .service-row strong { text-align:right; overflow-wrap:anywhere; }
    .services-footer { padding:14px 0 0; margin-top:4px; }
    .demo-activity,.timeline { max-height:360px; overflow:auto; }
    .demo-event { display:grid; grid-template-columns:65px 1fr; gap:10px; border-bottom:1px solid #eef1f5; padding:10px 0; font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
    .time,.event .cat { color:var(--muted); }
    .activity-diagnostics { margin-top:14px; }
    .activity-diagnostics summary { color:var(--muted); font-weight:400; }
    .empty { padding:28px 8px; color:var(--muted); font-size:13px; line-height:1.65; text-align:center; }
    .empty strong { display:block; color:var(--ink); margin-bottom:5px; font-size:15px; }
    .empty .btn { margin-top:16px; }
    .info-strip { padding:12px; border:1px solid #dde6fa; background:#f3f6ff; border-radius:7px; font-size:12px; color:#465b80; line-height:1.6; margin-bottom:15px; }
    .scenario { position:relative; padding:15px 68px 15px 0; border-bottom:1px solid var(--line); }
    .scenario:last-child { border:0; }
    .scenario-title { font-size:13px; font-weight:650; line-height:1.5; margin-bottom:4px; }
    .scenario-actions { position:absolute; right:0; top:18px; }
    .scenario-actions .btn { padding:7px 11px; }
    .run-summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:18px 0; }
    .metric .label { font-size:11px; color:var(--muted); }
    .metric .value { font-size:20px; font-weight:700; margin-top:4px; }
    .status-line { display:flex; gap:12px; justify-content:space-between; align-items:center; flex-wrap:wrap; margin-bottom:15px; }
    .progress { height:5px; background:#e6eaf2; border-radius:99px; overflow:hidden; }
    .progress>div { height:100%; background:var(--accent); transition:width .25s; }
    .tabs { display:flex; gap:18px; border-bottom:1px solid var(--line); margin:16px 0 10px; overflow:auto; }
    .tab { white-space:nowrap; border:0; border-bottom:2px solid transparent; background:none; padding:10px 0; color:var(--muted); font-size:13px; }
    .tab.active { color:var(--accent); border-bottom-color:var(--accent); }
    .panel { display:none; }
    .panel.active { display:block; }
    .event { display:grid; grid-template-columns:70px 95px 1fr; gap:10px; font-size:12px; padding:10px 0; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }
    .assertion { display:grid; grid-template-columns:20px 1fr auto; gap:10px; padding:12px 0; border-bottom:1px solid var(--line); font-size:13px; }
    .pass { color:#26724c; font-weight:700; }
    .fail { color:#b42318; font-weight:700; }
    .provider { display:inline-flex; font-size:12px; border-radius:5px; padding:5px 8px; margin:4px 4px 0 0; background:var(--soft); }
    .link { font-size:12px; color:var(--accent); text-decoration:none; font-weight:600; }
    .error-box { white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; line-height:1.6; padding:13px; color:#8a4913; background:#fff5e8; border:1px solid #f3d8b2; border-radius:8px; margin:0 0 16px; }
    .toast { position:fixed; bottom:22px; right:22px; z-index:30; max-width:calc(100vw - 32px); padding:12px 16px; color:#fff; background:var(--ink); border-radius:8px; box-shadow:0 6px 24px #202c4033; font-size:13px; }
    .confirm-dialog { width:min(440px,calc(100% - 32px)); padding:24px; border:1px solid var(--line); border-radius:12px; color:var(--ink); box-shadow:0 24px 70px #172b4d44; }
    .confirm-dialog::backdrop { background:#172b4d66; }
    .confirm-dialog h2 { font-size:20px; margin-bottom:8px; }
    .confirm-dialog p { color:var(--muted); font-size:13px; line-height:1.6; margin:0 0 20px; }
    .confirm-dialog .toolbar { justify-content:flex-end; margin-top:20px; }
    .checkbox-field { display:flex; align-items:flex-start; gap:8px; font-size:12px; line-height:1.6; color:var(--muted); }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    @media(max-width:1150px) { .interactive-workspace { grid-template-columns:210px minmax(0,1fr); gap:16px; } .demo-grid { grid-template-columns:minmax(260px,1fr) minmax(0,1fr); gap:14px; } .shell { padding:0 20px 32px; } .card-head,.card-body { padding:15px; } }
    @media(max-width:960px) { .demo-grid { grid-template-columns:1fr; } .grid { grid-template-columns:minmax(260px,.8fr) minmax(0,1fr); } .run-summary { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media(max-width:700px) { .shell { padding:0 14px 28px; } .topbar { align-items:flex-start; flex-direction:column; gap:12px; padding:16px 0; } .context-banner { align-items:flex-start; } .context-banner p { font-size:12px; } .live-caption { display:none; } .interactive-workspace,.grid { grid-template-columns:1fr; } .session-sidebar { position:static; } .demo-session-list { max-height:220px; } .session-shared-note { font-size:12px; } .search-input,select,.confirm-input { font-size:16px!important; } .event { grid-template-columns:65px 1fr; } .event .cat { grid-column:2; } .toolbar { flex-wrap:wrap; } .result-cell.company strong { font-size:20px; } }
    @media(prefers-reduced-motion:reduce) { * { transition:none!important; } }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand"><div class="brand-logo" aria-hidden="true">T.</div><div>
        <h1>Testy</h1>
        <div class="sub">Your GL-EYE testing workspace</div>
      </div></div>
      <div class="health">
        <span id="controlHealth" class="badge warn">Control Plane · checking</span>
        <span id="targetHealth" class="badge warn">Target · checking</span>
      </div>
    </header>

    <nav class="mode-switch" role="tablist" aria-label="Testing modes">
      <button id="automatedModeButton" class="mode-button active" role="tab" aria-controls="automatedMode" aria-selected="true">Automated tests</button>
      <button id="interactiveModeButton" class="mode-button" role="tab" aria-controls="interactiveMode" aria-selected="false">Visitor simulator</button>
    </nav>
    <div class="context-banner"><div><h2 id="modeHeading">Automated testing</h2><p id="modeDescription">Choose a scenario and inspect its execution and evidence.</p></div><div class="live-caption"><span class="live-dot" aria-hidden="true"></span>Live status</div></div>

    <section id="automatedMode" class="mode-view active" role="tabpanel" aria-labelledby="automatedModeButton">
    <div class="grid">
      <section class="card">
        <div class="card-head">
          <div><h2>Scenarios <span id="scenarioCount" class="meta"></span></h2><div class="heading-description">Choose a test to launch</div></div><div class="toolbar"><label for="scenarioSearch" class="sr-only">Search scenarios</label><input id="scenarioSearch" class="search-input" type="search" placeholder="Search scenarios"><button class="btn secondary" id="refreshScenarios">Refresh</button></div>
        </div>
        <div class="card-body"><div id="scenarioActionMessage" class="error-box" role="alert" hidden></div><div id="scenarioList"><div class="empty">Loading scenarios…</div></div></div>
      </section>

      <section class="card">
        <div class="card-head">
          <div><h2>Run inspector</h2><div class="heading-description">Live execution, assertions and evidence</div></div>
          <div>
            <button id="copyRunId" class="btn secondary" hidden>Copy ID</button> <button id="refreshRun" class="btn secondary" hidden>Refresh</button> <a id="htmlReportLink" class="link" href="#" target="_blank" rel="noopener" hidden>Open report ↗</a>
          </div>
        </div>
        <div class="card-body">
          <div id="noRun" class="empty"><strong>Ready for your first run</strong>Choose a scenario on the left and press Run to follow its progress here.</div>
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
            <div id="runError" class="error-box" role="alert" hidden></div>
          </div>
        </div>
      </section>
    </div>
    </section>

    <section id="interactiveMode" class="mode-view" role="tabpanel" aria-labelledby="interactiveModeButton">
      <div class="interactive-workspace">
        <aside class="session-sidebar card" aria-label="Demo sessions">
          <div class="card-head"><h2>Sessions</h2></div>
          <div class="card-body">
            <button id="newDemoSession" class="btn primary new-session-button" data-demo-action>+ New session</button>
            <div class="toolbar"><label for="demoSessionSearch" class="sr-only">Search sessions</label><input id="demoSessionSearch" class="search-input" type="search" placeholder="Find a workspace…"><button id="refreshDemoSessions" class="btn secondary" aria-label="Refresh sessions">↻</button></div>
            <div class="demo-session-tabs" role="tablist" aria-label="Demo session lists">
              <button id="demoActiveTab" class="demo-session-tab active" data-demo-tab="active" role="tab" aria-selected="true">Active <span id="demoActiveCount">0</span></button>
              <button id="demoHibernatedTab" class="demo-session-tab" data-demo-tab="hibernated" role="tab" aria-selected="false">Saved / failed <span id="demoHibernatedCount">0</span></button>
            </div>
            <h2 id="demoSessionListTitle" class="sr-only">Active sessions</h2>
            <div id="demoSessionList" class="demo-session-list"><div class="empty">Loading sessions…</div></div>
            <div class="session-shared-note">Shared sessions. Changes affect everyone using the selected workspace.</div>
          </div>
        </aside>
        <div class="demo-workspace">
          <header class="workspace-heading"><div><h2 id="selectedWorkspaceHeading">Choose a workspace</h2><div id="demoSessionMeta" class="meta">Open a session on the left or create a new one.</div></div><span id="demoStatus" class="badge warn">Not selected</span></header>
          <div class="demo-grid">
            <section class="card">
              <div class="card-head"><div><div class="stage-label">1 · Set up a visitor</div><h2>Visitor identity</h2></div><span id="demoVisitorState" class="badge" hidden>Applied</span></div>
              <div class="card-body">
                <div id="demoNoSession" class="empty"><strong>Ready to try GL-EYE?</strong>Create a workspace or open a shared session to simulate a visitor.<br><button id="newDemoSessionEmpty" class="btn primary" data-demo-action>Create a session</button></div>
                <div id="demoInactiveMessage" class="info-strip" hidden></div>
                <div id="demoVisitorControls" hidden>
                  <div class="field"><label for="demoNetwork">Network</label><select id="demoNetwork"></select></div>
                  <div class="field"><label for="demoPerson">Person</label><select id="demoPerson"></select></div>
                  <div class="field"><label for="demoBrowser">Browser</label><select id="demoBrowser"></select></div>
                  <div class="visitor-primary-actions"><button id="applyDemoVisitor" class="btn primary" data-demo-action>Apply visitor</button><button id="openDemoWebsite" class="btn secondary" data-demo-action>2 · Open demo website ↗</button></div>
                  <p id="demoVisitorFeedback" class="visitor-feedback" aria-live="polite"></p>
                  <div id="demoIdentitySummary" class="meta identity-summary" style="margin-top:14px;padding-bottom:0"></div>
                  <div class="visitor-secondary-actions"><button id="resetDemoVisitor" class="text-button" data-demo-action>Reset browser identity</button></div>
                </div>
                <button id="resumeDemo" class="btn primary" data-demo-action hidden>Resume session</button>
                <details id="demoCredentialDetails" class="workspace-details" hidden><summary>GL-EYE login &amp; workspace</summary>
                  <div id="demoCredentialPanel" class="result-grid credential-grid" hidden>
                    <div class="result-cell"><div class="meta">Workspace</div><strong id="demoWorkspaceName">—</strong></div>
                    <div class="result-cell"><div class="meta">Session ID</div><strong id="demoCredentialSessionId">—</strong></div>
                    <div class="result-cell"><div class="meta">Email</div><strong id="demoCredentialEmail">—</strong><div class="cell-actions"><button id="copyDemoEmail" class="text-button">Copy email</button></div></div>
                    <div class="result-cell"><div class="meta">Password</div><strong id="demoCredentialPassword">—</strong><div class="cell-actions"><button id="toggleDemoPassword" class="text-button" aria-pressed="false">Show</button><button id="copyDemoPassword" class="text-button">Copy password</button></div></div>
                  </div>
                </details>
                <details id="demoSessionOptions" class="workspace-details" hidden><summary>Session options</summary><div class="meta">Save and pause to keep the GL-EYE workspace and stop live traffic.</div><div class="demo-actions session-controls"><button id="hibernateDemo" class="btn secondary" data-demo-action hidden>Save &amp; pause</button></div><div class="danger-zone"><button id="stopDemo" class="btn danger" data-demo-action hidden>Delete workspace…</button></div></details>
              </div>
            </section>
            <div>
              <section class="card">
                <div class="card-head"><div><div class="stage-label">3 · Inspect the result</div><h2>GL-EYE result</h2></div><button id="refreshDemoResult" class="text-button" hidden>Refresh</button></div>
                <div class="card-body">
                  <div id="demoErrorPanel" class="error-box" role="alert" hidden><strong id="demoErrorTitle">Session needs attention</strong><details style="margin-top:8px"><summary>Technical details</summary><div id="demoError" style="margin-top:8px" hidden></div></details></div>
                  <div id="demoResultEmpty" class="empty"><strong>Waiting for a visitor</strong>Apply a visitor, open the demo website, and browse to see GL-EYE results here.</div>
                  <div id="demoResult" class="result-grid" hidden>
                    <div class="result-cell company"><div class="meta">Detected company</div><strong id="demoCompanies">—</strong></div>
                    <div class="result-cell"><div class="meta">Accepted events</div><strong id="demoProcessedEventCount">0</strong></div>
                    <div class="result-cell"><div class="meta">Companies</div><strong id="demoCompanyCount">0</strong></div>
                    <div class="result-cell"><div class="meta">Confidence</div><strong id="demoConfidence">—</strong></div>
                    <div class="result-cell"><div class="meta">Scores</div><strong id="demoScoreCount">0</strong></div>
                    <div class="result-cell company"><div class="meta">Providers</div><strong id="demoProviders" style="font-size:13px">—</strong></div>
                  </div>
                  <div id="demoOutcomeUpdated" class="meta" style="margin-top:12px" hidden></div>
                </div>
              </section>
              <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>Recent activity</h2><div class="heading-description">Visitor, provider and gateway events</div></div><button id="refreshDemoActivity" class="text-button" hidden>Refresh</button></div><div class="card-body"><div id="demoActivity" class="demo-activity"><div class="empty">Activity appears as you browse.</div></div><details class="activity-diagnostics"><summary>Polling diagnostics <span id="demoDiagnosticsCount"></span></summary><div id="demoDiagnostics" class="demo-activity"></div></details></div></section>
            </div>
          </div>
          <details class="services-footer"><summary>Connected services</summary><div class="service-list"><div class="service-row"><span>GL-EYE</span><strong id="demoGlEyeService">Checking</strong></div><div class="service-row"><span>GL-EYE workspace</span><strong id="demoWorkspaceService">Created per session</strong></div><div class="service-row"><span>Traffic Gateway</span><strong id="demoTrafficService">Session managed</strong></div><div class="service-row"><span>IPinfo · Apollo · Hunter</span><strong>Mocked</strong></div></div></details>
        </div>
      </div>
    </section>
  </main>
  <dialog id="newDemoDialog" class="confirm-dialog" aria-labelledby="newDemoTitle"><h2 id="newDemoTitle">Create a test session</h2><p>A fresh GL-EYE workspace with synthetic visitors and simulated providers.</p><div class="field" id="demoCredentialModeField"><label for="demoCredentialMode">Demo login</label><select id="demoCredentialMode"><option value="shared">Reusable demo account</option><option value="generated">Generate a session account</option></select><div class="meta">Both options create a new workspace.</div></div><label class="checkbox-field"><input id="demoKeepWorkspace" type="checkbox">Keep workspace after timeout (save and pause instead of delete)</label><div id="newDemoError" class="error-box" role="alert" hidden style="margin-top:14px"></div><div class="toolbar"><button id="cancelNewDemo" class="btn secondary">Cancel</button><button id="startDemo" class="btn primary" data-demo-action>Create session</button></div></dialog>
  <dialog id="deleteDemoDialog" class="confirm-dialog" aria-labelledby="deleteDemoTitle"><h2 id="deleteDemoTitle">Permanently delete workspace?</h2><p>The session, GL-EYE workspace and all of its data will be removed. Hibernate instead if you want to preserve it.</p><div class="info-strip"><strong id="deleteDemoWorkspace">—</strong><div id="deleteDemoId" class="session-id"></div></div><label class="field" style="margin-top:16px"><span>Type <strong>DELETE</strong> to continue</span><input id="deleteDemoConfirmation" class="confirm-input" autocomplete="off" spellcheck="false"></label><div class="toolbar"><button id="cancelDeleteDemo" class="btn secondary">Keep workspace</button><button id="confirmDeleteDemo" class="btn danger" disabled>Delete permanently</button></div></dialog><div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <script>
    const visitorSelectionChanged = ${visitorSelectionChanged.toString()};
    const isDemoDiagnostic = ${isDemoDiagnostic.toString()};
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
    let demoSessions = [];
    let demoSessionTab = localStorage.getItem("testy.demoSessionTab") === "hibernated" ? "hibernated" : "active";
    let toastTimer;
    let demoPasswordVisible = false;
    let demoActionBusy = false;
    let demoRefreshGeneration = 0;


    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function notify(message) {
      const toast = document.getElementById("toast");
      toast.textContent = message;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.hidden = true; }, 3500);
    }
    async function copyText(value, label) {
      if (!value || value === "—") return;
      try {
        await navigator.clipboard.writeText(value);
        notify(label + " copied");
      } catch {
        notify("Clipboard unavailable. Select the text to copy.");
      }
    }
    function renderDemoPassword() {
      const value = currentDemo?.credentialPassword;
      document.getElementById("demoCredentialPassword").textContent =
        !value ? "Not available" : demoPasswordVisible ? value : "••••••••••••";
      document.getElementById("toggleDemoPassword").textContent = demoPasswordVisible ? "Hide" : "Show";
      document.getElementById("toggleDemoPassword").setAttribute("aria-pressed", String(demoPasswordVisible));
      document.getElementById("copyDemoPassword").disabled = !value;
    }
    function setDemoBusy(busy) {
      demoActionBusy = busy;
      document.querySelectorAll("button[data-demo-action], button[data-demo-id]").forEach(function (button) {
        button.disabled = busy;
      });
      document.getElementById("cancelNewDemo").disabled = busy;
      updateDemoVisitorState();
    }
    function clearDemoResults() {
      document.getElementById("demoResult").hidden = true;
      document.getElementById("demoResultEmpty").hidden = false;
      document.getElementById("demoResultEmpty").textContent = "Open a ready session and browse the website to generate GL-EYE results.";
      document.getElementById("demoActivity").innerHTML = '<div class="empty">No activity for this session yet.</div>';
      document.getElementById("demoDiagnostics").innerHTML = "";
      document.getElementById("demoDiagnosticsCount").textContent = "";
      document.getElementById("demoOutcomeUpdated").hidden = true;
    }
    function renderFilteredScenarios() {
      const term = document.getElementById("scenarioSearch").value.trim().toLowerCase();
      document.querySelectorAll("#scenarioList .scenario").forEach(function (item) {
        item.hidden = !item.textContent.toLowerCase().includes(term);
      });
      const matching = [...document.querySelectorAll("#scenarioList .scenario")].filter(function (item) { return !item.hidden; }).length;
      document.getElementById("scenarioCount").textContent = "(" + matching + "/" + scenarios.length + ")";
      let empty = document.getElementById("scenarioSearchEmpty");
      if (!empty) {
        empty = document.createElement("div");
        empty.id = "scenarioSearchEmpty";
        empty.className = "empty";
        document.getElementById("scenarioList").append(empty);
      }
      empty.textContent = "No scenarios match your search.";
      empty.hidden = !term || matching > 0 || scenarios.length === 0;
    }
    function formatDate(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
    }
    function displaySessionStatus(status) {
      return ({ READY:"Ready", ACTIVE:"Active", HIBERNATED:"Saved", HIBERNATING:"Saving", RESUMING:"Resuming", PROVISIONING:"Preparing", FAILED:"Failed", STOPPED:"Deleted" })[status] || status;
    }
    async function withDemoAction(callback) {
      if (demoActionBusy) return;
      setDemoBusy(true);
      try { await callback(); } finally { setDemoBusy(false); }
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
      document.getElementById("automatedModeButton").setAttribute("aria-selected", String(automated));
      document.getElementById("interactiveModeButton").setAttribute("aria-selected", String(!automated));
      document.getElementById("modeHeading").textContent = automated ? "Automated tests" : "Visitor simulator";
      document.getElementById("modeDescription").textContent = automated ? "Choose a scenario, run it, and inspect the evidence." : "Set up a visitor, browse the demo website, and watch GL-EYE respond.";
      localStorage.setItem("testy.mode", mode);
      if (!automated) {
        void loadDemoProfiles();
        void refreshDemoSession();
      } else {
        clearTimeout(demoPollTimer);
      }
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
      document.getElementById("demoPerson").dataset.networkId = "";
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
      const previousPerson = select.value;
      select.innerHTML = '<option value="">Anonymous / none</option>' + people.map(function (person) {
        return '<option value="' + escapeHtml(person.id) + '">' + escapeHtml(person.displayName) + '</option>';
      }).join("");
      const desired = select.dataset.networkId === networkId ? previousPerson : (currentDemo ? (currentDemo.personIdentityId || "") : demoProfiles.defaults.personId);
      select.dataset.networkId = networkId;
      select.value = desired === "" ? "" : people.some(function (person) { return person.id === desired; })
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
      updateDemoVisitorState();
    }

    function demoVisitorHasChanges() {
      if (!currentDemo || !demoProfiles) return false;
      return visitorSelectionChanged({
        networkId: currentDemo.networkIdentityId || demoProfiles.defaults.networkId,
        personId: currentDemo.personIdentityId || "",
        browserId: currentDemo.browserIdentityId || demoProfiles.defaults.browserId,
      }, {
        networkId: document.getElementById("demoNetwork").value,
        personId: document.getElementById("demoPerson").value,
        browserId: document.getElementById("demoBrowser").value,
      });
    }

    function updateDemoVisitorState() {
      const active = currentDemo && ["READY", "ACTIVE"].includes(currentDemo.status);
      const changed = demoVisitorHasChanges();
      const badge = document.getElementById("demoVisitorState");
      badge.hidden = !active;
      setBadge(badge, changed ? "Not applied" : "Applied", changed ? "warn" : "ok");
      const feedback = document.getElementById("demoVisitorFeedback");
      feedback.textContent = changed ? "Apply these changes before opening the website. Results still reflect the applied visitor." : "Visitor settings are applied. Open the website to generate activity.";
      feedback.classList.toggle("pending", changed);
      document.getElementById("openDemoWebsite").disabled = demoActionBusy || !active || !demoProfiles || changed || !currentDemo?.websiteUrl;
      document.getElementById("applyDemoVisitor").disabled = demoActionBusy || !active || !demoProfiles;
    }

    async function startInteractiveDemo() {
      clearTimeout(demoPollTimer);
      document.getElementById("startDemo").disabled = true;
      document.getElementById("startDemo").textContent = "Creating session…";
      showDemoError("", true);
      try {
        await loadDemoProfiles();
        const created = await requestJson("/v1/demo-sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            credentialMode: document.getElementById("demoCredentialMode").value,
            keepWorkspace: document.getElementById("demoKeepWorkspace").checked,
          }),
        });
        demoRefreshGeneration++;
        currentDemo = created;
        currentDemoId = created.id;
        demoPasswordVisible = false;
        clearDemoResults();
        demoSelectorsSessionId = "";
        localStorage.setItem("testy.currentDemoId", currentDemoId);
        document.getElementById("newDemoDialog").close();
        chooseDemoSessionTab("active");
        renderDemoSession();
        renderDemoSelectors(true);
        await refreshDemoActivity();
        await refreshDemoList();
        notify("Demo workspace created");
        scheduleDemoPoll();
      } catch (error) {
        showDemoError("Unable to start demo: " + error.message, true);
      } finally {
        document.getElementById("startDemo").disabled = false;
        document.getElementById("startDemo").textContent = "Create session";
        scheduleDemoPoll();
      }
    }

    function chooseDemoSessionTab(tab) {
      demoSessionTab = tab === "hibernated" ? "hibernated" : "active";
      localStorage.setItem("testy.demoSessionTab", demoSessionTab);
      document.querySelectorAll(".demo-session-tab").forEach(function (button) {
        const selected = button.dataset.demoTab === demoSessionTab;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", String(selected));
      });
      document.getElementById("demoSessionListTitle").textContent =
        demoSessionTab === "active" ? "Active sessions" : "Hibernated workspaces";
      renderDemoList();
    }

    function renderDemoList() {
      const active = demoSessions.filter(function (item) {
        return !["HIBERNATED","HIBERNATING","FAILED"].includes(item.status);
      });
      const hibernated = demoSessions.filter(function (item) {
        return ["HIBERNATED","HIBERNATING","FAILED"].includes(item.status);
      });
      document.getElementById("demoActiveCount").textContent = String(active.length);
      document.getElementById("demoHibernatedCount").textContent = String(hibernated.length);
      const query = document.getElementById("demoSessionSearch").value.trim().toLowerCase();
      const shown = (demoSessionTab === "active" ? active : hibernated).filter(function (item) { return [item.id,item.workspaceName,item.credentialEmail,item.status].some(function (field) { return String(field || "").toLowerCase().includes(query); }); });
      document.getElementById("demoSessionList").innerHTML = shown.length
        ? shown.map(function (session) {
            const selected = session.id === currentDemoId;
            return '<button class="demo-session-item' + (selected ? ' selected' : '') + '" data-demo-id="' + escapeHtml(session.id) + '" aria-pressed="' + selected + '"' + (demoActionBusy ? ' disabled' : '') + '>' +
              '<strong>' + escapeHtml(session.workspaceName || "Test workspace") + '</strong>' +
              '<span class="meta">' + escapeHtml(session.credentialEmail || "No email") + '</span>' +
              '<span class="session-meta-row"><span class="badge ' + (session.status === "FAILED" ? "bad" : session.status === "HIBERNATED" ? "warn" : "ok") + '">' + escapeHtml(displaySessionStatus(session.status)) + '</span>' +
              '<span class="session-id">' + escapeHtml(new Date(session.updatedAt).toLocaleDateString()) + '</span></span></button>';
          }).join("")
        : '<div class="empty"><strong>No matching sessions</strong>Try another search or create a new session.</div>';
    }

    async function refreshDemoList() {
      try {
        const result = await requestJson("/v1/demo-sessions");
        demoSessions = result.sessions || [];
        renderDemoList();
      } catch (error) {
        document.getElementById("demoSessionList").textContent =
          "Unable to load shared sessions: " + error.message;
      }
    }

    async function selectDemoSession(id) {
      if (!id || demoActionBusy) return;
      demoRefreshGeneration++;
      currentDemoId = id;
      currentDemo = undefined;
      demoPasswordVisible = false;
      clearDemoResults();
      renderDemoSession();
      demoSelectorsSessionId = "";
      localStorage.setItem("testy.currentDemoId", id);
      showDemoError("");
      await refreshDemoSession();
    }

    async function refreshDemoSession() {
      await refreshDemoList();
      if (!currentDemoId) {
        currentDemo = undefined;
        renderDemoSession();
        scheduleDemoPoll();
        return;
      }
      const requestedId = currentDemoId;
      const requestedGeneration = demoRefreshGeneration;
      try {
        const fetched = await requestJson("/v1/demo-sessions/" + encodeURIComponent(requestedId));
        if (requestedId !== currentDemoId || requestedGeneration !== demoRefreshGeneration) return;
        if (fetched.status === "STOPPED") {
          currentDemoId = "";
          currentDemo = undefined;
          localStorage.removeItem("testy.currentDemoId");
          demoSelectorsSessionId = "";
          showDemoError("");
          renderDemoSession();
          await refreshDemoList();
          return;
        }
        currentDemo = fetched;
        renderDemoSession();
        if (fetched.status === "READY" || fetched.status === "ACTIVE") {
          await refreshDemoActivity();
          await refreshDemoOutcome(false);
        }
      } catch (error) {
        if (requestedId !== currentDemoId || requestedGeneration !== demoRefreshGeneration) return;
        if (error.status === 404 && requestedId === currentDemoId) {
          currentDemoId = "";
          currentDemo = undefined;
          localStorage.removeItem("testy.currentDemoId");
          renderDemoSession();
        } else {
          showDemoError("Unable to refresh demo: " + error.message);
        }
      } finally {
        if (document.getElementById("interactiveMode").classList.contains("active")) {
          scheduleDemoPoll();
        }
      }
    }

    function renderDemoSession() {
      const active = currentDemo && ["READY", "ACTIVE"].includes(currentDemo.status);
      const status = document.getElementById("demoStatus");
      const credentialPanel = document.getElementById("demoCredentialPanel");
      document.getElementById("selectedWorkspaceHeading").textContent = currentDemo?.workspaceName || "Choose a workspace";
      document.getElementById("demoNoSession").hidden = Boolean(currentDemoId);
      document.getElementById("demoCredentialDetails").hidden = !currentDemo;
      document.getElementById("demoSessionOptions").hidden = !currentDemo;
      const inactive = document.getElementById("demoInactiveMessage");
      inactive.hidden = !currentDemoId || Boolean(active);
      if (!currentDemo) {
        setBadge(status, currentDemoId ? "Loading" : "Not selected", "warn");
        document.getElementById("demoSessionMeta").textContent = "Open a session on the left or create a new one.";
        inactive.textContent = "Loading the selected workspace…";
        credentialPanel.hidden = true;
        document.getElementById("demoWorkspaceService").textContent = "Created per session";
      } else {
        setBadge(status, displaySessionStatus(currentDemo.status), currentDemo.status === "FAILED" ? "bad" : active ? "ok" : "warn");
        document.getElementById("demoSessionMeta").textContent = "Started " + formatDate(currentDemo.startedAt) + " · Shared workspace";
        inactive.textContent = currentDemo.status === "HIBERNATED" ? "Workspace saved. Resume this session to generate new visitor activity." : currentDemo.status === "FAILED" ? "This session could not be prepared. Review the session error or create a new session." : "Workspace " + displaySessionStatus(currentDemo.status).toLowerCase() + ". Visitor controls become available when ready.";
        credentialPanel.hidden = false;
        document.getElementById("demoWorkspaceName").textContent = currentDemo.workspaceName || "—";
        document.getElementById("demoCredentialSessionId").textContent = currentDemo.id || "—";
        document.getElementById("demoCredentialEmail").textContent = currentDemo.credentialEmail || "—";
        document.getElementById("demoWorkspaceService").textContent = currentDemo.status === "STOPPED" ? "Deleted" : (currentDemo.workspaceName || "Session managed");
      }
      renderDemoPassword();
      document.getElementById("refreshDemoActivity").hidden = !active;
      document.getElementById("demoVisitorControls").hidden = !active;
      document.getElementById("applyDemoVisitor").hidden = !active;
      document.getElementById("openDemoWebsite").hidden = !active;
      document.getElementById("resetDemoVisitor").hidden = !active;
      document.getElementById("hibernateDemo").hidden = !currentDemo || !(["READY","ACTIVE","HIBERNATING"].includes(currentDemo.status) || (currentDemo.status === "FAILED" && currentDemo.targetRunId && currentDemo.keepWorkspace));
      document.getElementById("hibernateDemo").disabled = demoActionBusy;
      document.getElementById("hibernateDemo").textContent = currentDemo?.status === "FAILED" ? "Retry save & pause" : "Save & pause";
      document.getElementById("resumeDemo").hidden = !currentDemo || currentDemo.status !== "HIBERNATED";
      document.getElementById("stopDemo").hidden = !currentDemo || currentDemo.status === "STOPPED";
      document.getElementById("refreshDemoResult").hidden = !active;
      if (currentDemo && !active) {
        document.getElementById("demoResult").hidden = true;
        document.getElementById("demoResultEmpty").hidden = false;
        document.getElementById("demoOutcomeUpdated").hidden = true;
        document.getElementById("demoResultEmpty").textContent = currentDemo.status === "HIBERNATED" ? "Live tracking is paused. Historical data remains in the GL-EYE workspace; resume to see live results." : "Results become available when the workspace is ready.";
        document.getElementById("demoActivity").innerHTML = '<div class="empty">' + (currentDemo.status === "HIBERNATED" ? "Session saved. Live activity is paused." : "Waiting for the workspace to be ready.") + '</div>';
        document.getElementById("demoDiagnostics").innerHTML = "";
        document.getElementById("demoDiagnosticsCount").textContent = "";
      }
      document.getElementById("demoGlEyeService").textContent = glEyeReady ? "Connected" : "Not ready";
      if (demoProfiles && active) renderDemoSelectors(false);
      updateDemoVisitorState();
      showDemoError(currentDemo?.errorMessage || "");
    }

    async function applyDemoVisitorSelection() {
      if (!currentDemoId) return;
      const selectedId = currentDemoId;
      const generation = ++demoRefreshGeneration;
      showDemoError("");
      const personId = document.getElementById("demoPerson").value;
      try {
        const applied = await requestJson("/v1/demo-sessions/" + encodeURIComponent(selectedId) + "/visitor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            networkId: document.getElementById("demoNetwork").value,
            ...(personId ? { personId: personId } : {}),
            browserId: document.getElementById("demoBrowser").value,
          }),
        });
        if (selectedId !== currentDemoId || generation !== demoRefreshGeneration) return;
        currentDemo = applied;
        clearDemoResults();
        renderDemoSession();
        renderDemoSelectors(true);
        await refreshDemoActivity();
        await refreshDemoOutcome(false);
        notify("Visitor identity applied");
      } catch (error) {
        showDemoError("Unable to apply visitor: " + error.message);
      }
    }

    async function resetInteractiveVisitor() {
      if (!currentDemoId) return;
      const selectedId = currentDemoId;
      const generation = ++demoRefreshGeneration;
      showDemoError("");
      try {
        const reset = await requestJson("/v1/demo-sessions/" + encodeURIComponent(selectedId) + "/reset-visitor", { method: "POST" });
        if (selectedId !== currentDemoId || generation !== demoRefreshGeneration) return;
        currentDemo = reset;
        clearDemoResults();
        renderDemoSession();
        renderDemoSelectors(true);
        await refreshDemoActivity();
        await refreshDemoOutcome(false);
        notify("Browser identity reset");
      } catch (error) {
        showDemoError("Unable to reset visitor: " + error.message);
      }
    }

    async function hibernateInteractiveDemo() {
      if (!currentDemoId) return;
      const selectedId = currentDemoId;
      const generation = ++demoRefreshGeneration;
      showDemoError("");
      try {
        const saved = await requestJson(
          "/v1/demo-sessions/" + encodeURIComponent(selectedId) + "/hibernate",
          { method: "POST" },
        );
        if (selectedId !== currentDemoId || generation !== demoRefreshGeneration) return;
        currentDemo = saved;
        clearDemoResults();
        chooseDemoSessionTab("hibernated");
        renderDemoSession();
        await refreshDemoList();
        notify("Workspace hibernated");
      } catch (error) {
        showDemoError("Unable to hibernate demo: " + error.message);
      }
    }

    async function resumeInteractiveDemo() {
      if (!currentDemoId) return;
      const selectedId = currentDemoId;
      const generation = ++demoRefreshGeneration;
      showDemoError("");
      try {
        const resumed = await requestJson(
          "/v1/demo-sessions/" + encodeURIComponent(selectedId) + "/resume",
          { method: "POST" },
        );
        if (selectedId !== currentDemoId || generation !== demoRefreshGeneration) return;
        currentDemo = resumed;
        clearDemoResults();
        chooseDemoSessionTab("active");
        renderDemoSession();
        renderDemoSelectors(true);
        await refreshDemoList();
        notify("Workspace resumed");
      } catch (error) {
        showDemoError("Unable to resume demo: " + error.message);
      }
    }

    async function stopInteractiveDemo() {
      if (!currentDemoId) return;
      const dialog = document.getElementById("deleteDemoDialog");
      document.getElementById("deleteDemoWorkspace").textContent = currentDemo?.workspaceName || "Selected workspace";
      document.getElementById("deleteDemoId").textContent = currentDemoId;
      document.getElementById("deleteDemoConfirmation").value = "";
      document.getElementById("confirmDeleteDemo").disabled = true;
      dialog.showModal();
    }

    async function confirmInteractiveDemoDeletion() {
      if (!currentDemoId || document.getElementById("deleteDemoConfirmation").value !== "DELETE") return;
      const dialog = document.getElementById("deleteDemoDialog");
      document.getElementById("confirmDeleteDemo").disabled = true;
      showDemoError("");
      try {
        const deletedId = currentDemoId;
        const result = await requestJson("/v1/demo-sessions/" + encodeURIComponent(deletedId), { method: "DELETE" });
        if (result.status !== "STOPPED") {
          throw new Error(result.errorMessage || "Workspace deletion was not confirmed.");
        }
        if (currentDemoId === deletedId) {
          currentDemoId = "";
          currentDemo = undefined;
          localStorage.removeItem("testy.currentDemoId");
        }
        demoRefreshGeneration++;
        demoPasswordVisible = false;
        clearDemoResults();
        renderDemoSession();
        await refreshDemoList();
        dialog.close();
        notify("Workspace deleted");
      } catch (error) {
        showDemoError("Unable to permanently delete session: " + error.message);
        document.getElementById("confirmDeleteDemo").disabled = false;
        dialog.close();
      }
    }

    function openInteractiveWebsite() {
      if (demoActionBusy || demoVisitorHasChanges()) return;
      if (currentDemo?.websiteUrl && ["READY", "ACTIVE"].includes(currentDemo.status)) window.open(currentDemo.websiteUrl, "_blank", "noopener");
    }

    async function refreshDemoOutcome(showErrors) {
      if (!currentDemoId || !currentDemo || !["READY","ACTIVE"].includes(currentDemo.status)) return;
      const selectedId = currentDemoId;
      const generation = demoRefreshGeneration;
      try {
        const result = await requestJson("/v1/demo-sessions/" + encodeURIComponent(currentDemoId) + "/outcome");
        if (selectedId !== currentDemoId || generation !== demoRefreshGeneration || !["READY","ACTIVE"].includes(currentDemo?.status)) return;
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
        const updated = document.getElementById("demoOutcomeUpdated");
        updated.hidden = false;
        updated.textContent = "Applied visitor · Updated " + new Date().toLocaleTimeString();
      } catch (error) {
        if (showErrors) showDemoError("Unable to refresh GL-EYE result: " + error.message);
      }
    }

    async function refreshDemoActivity() {
      if (!currentDemoId || !currentDemo || !["READY","ACTIVE"].includes(currentDemo.status)) return;
      const selectedId = currentDemoId;
      const generation = demoRefreshGeneration;
      try {
        const result = await requestJson("/v1/demo-sessions/" + encodeURIComponent(currentDemoId) + "/activity");
        if (selectedId !== currentDemoId || generation !== demoRefreshGeneration || !["READY","ACTIVE"].includes(currentDemo?.status)) return;
        const events = [];
        const activityNames = {
          "visitor-profile-applied": "Visitor identity applied",
          "demo-session-created": "Session created",
          "demo-session-ready": "Workspace ready",
          "demo-session-resumed": "Session resumed",
          "demo-session-hibernated": "Workspace saved",
          "target-enrichment-triggered": "Contact enrichment requested",
          "target-enrichment-incomplete": "Contact enrichment incomplete",
          "vendor-runtime-ready": "Provider simulator ready",
        };
        (result.timeline || []).forEach(function (item) {
          events.push({ at: item.occurredAt, text: activityNames[item.name] || item.name });
        });
        (result.providerCalls || []).forEach(function (item) {
          events.push({ at: item.occurredAt, text: item.vendorId + " → " + (item.operationId || item.caseId || "provider call") });
        });
        (result.observations || []).forEach(function (item) {
          events.push({ at: item.observedAt, text: item.observationType + " · " + item.status, diagnostic: isDemoDiagnostic(item.observationType, item.status) });
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
        const recent = events.filter(function (event) { return !event.diagnostic; });
        const diagnostics = events.filter(function (event) { return event.diagnostic; });
        function renderEvents(items) {
          return items.slice(0, 80).map(function (event) {
              return '<div class="demo-event"><div class="time">' + escapeHtml(new Date(event.at).toLocaleTimeString()) +
                '</div><div>' + escapeHtml(event.text) + '</div></div>';
            }).join("");
        }
        document.getElementById("demoActivity").innerHTML = recent.length ? renderEvents(recent) : '<div class="empty">No visitor activity yet. Open the demo website and browse.</div>';
        document.getElementById("demoDiagnostics").innerHTML = diagnostics.length ? renderEvents(diagnostics) : '<div class="empty">No polling diagnostics yet.</div>';
        document.getElementById("demoDiagnosticsCount").textContent = "(" + diagnostics.length + ")";
      } catch {}
    }

    function scheduleDemoPoll() {
      clearTimeout(demoPollTimer);
      demoPollTimer = setTimeout(function () { void refreshDemoSession(); }, 2500);
    }

    function showDemoError(message, creationError) {
      const box = document.getElementById("demoError");
      box.hidden = !message;
      box.textContent = message || "";
      document.getElementById("demoErrorPanel").hidden = !message;
      document.getElementById("demoErrorTitle").textContent = message?.includes("enrichment did not materialize") ? "Contact enrichment incomplete" : "Session needs attention";
      if (creationError) {
        const dialogBox = document.getElementById("newDemoError");
        dialogBox.hidden = !message;
        dialogBox.textContent = message || "";
      }
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
        renderFilteredScenarios();
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

      const errorBox = document.getElementById("scenarioActionMessage");
      errorBox.hidden = true;
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
        errorBox.hidden = false;
        errorBox.textContent = "Unable to start run: " + error.message;
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
        document.getElementById("copyRunId").hidden = false;
        document.getElementById("refreshRun").hidden = false;
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

    function openNewDemoDialog() {
      if (demoActionBusy) return;
      document.getElementById("newDemoError").hidden = true;
      document.getElementById("newDemoDialog").showModal();
    }
    document.getElementById("newDemoSession").addEventListener("click", openNewDemoDialog);
    document.getElementById("newDemoSessionEmpty").addEventListener("click", openNewDemoDialog);
    document.getElementById("cancelNewDemo").addEventListener("click", function () { if (!demoActionBusy) document.getElementById("newDemoDialog").close(); });
    document.getElementById("newDemoDialog").addEventListener("cancel", function (event) { if (demoActionBusy) event.preventDefault(); });
    document.getElementById("automatedModeButton").addEventListener("click", function () { setMode("automated"); });
    document.getElementById("interactiveModeButton").addEventListener("click", function () { setMode("interactive"); });
    document.getElementById("scenarioSearch").addEventListener("input", renderFilteredScenarios);
    document.getElementById("demoSessionSearch").addEventListener("input", renderDemoList);
    document.getElementById("refreshRun").addEventListener("click", function () { void refreshRun(); });
    document.getElementById("copyRunId").addEventListener("click", function () { void copyText(currentRunId, "Run ID"); });
    document.getElementById("copyDemoEmail").addEventListener("click", function () { void copyText(currentDemo?.credentialEmail, "Email"); });
    document.getElementById("copyDemoPassword").addEventListener("click", function () { void copyText(currentDemo?.credentialPassword, "Password"); });
    document.getElementById("toggleDemoPassword").addEventListener("click", function () { demoPasswordVisible = !demoPasswordVisible; renderDemoPassword(); });
    document.getElementById("refreshDemoActivity").addEventListener("click", function () { void refreshDemoActivity(); });
    document.getElementById("cancelDeleteDemo").addEventListener("click", function () { document.getElementById("deleteDemoDialog").close(); });
    document.getElementById("deleteDemoConfirmation").addEventListener("input", function (event) { document.getElementById("confirmDeleteDemo").disabled = event.target.value !== "DELETE"; });
    document.getElementById("confirmDeleteDemo").addEventListener("click", function () { void confirmInteractiveDemoDeletion(); });
    document.getElementById("startDemo").addEventListener("click", function () { void withDemoAction(startInteractiveDemo); });
    document.getElementById("applyDemoVisitor").addEventListener("click", function () { void withDemoAction(applyDemoVisitorSelection); });
    document.getElementById("openDemoWebsite").addEventListener("click", openInteractiveWebsite);
    document.getElementById("resetDemoVisitor").addEventListener("click", function () { void withDemoAction(resetInteractiveVisitor); });
    document.getElementById("stopDemo").addEventListener("click", function () { void stopInteractiveDemo(); });
    document.getElementById("hibernateDemo").addEventListener("click", function () { void withDemoAction(hibernateInteractiveDemo); });
    document.getElementById("resumeDemo").addEventListener("click", function () { void withDemoAction(resumeInteractiveDemo); });
    document.getElementById("refreshDemoSessions").addEventListener("click", function () { void refreshDemoList(); });
    document.getElementById("demoSessionList").addEventListener("click", function (event) {
      const button = event.target.closest("button[data-demo-id]");
      if (button) void selectDemoSession(button.dataset.demoId);
    });
    document.querySelectorAll(".demo-session-tab").forEach(function (button) {
      button.addEventListener("click", function () { chooseDemoSessionTab(button.dataset.demoTab); });
    });
    document.querySelectorAll('[role="tablist"]').forEach(function (group) {
      group.addEventListener("keydown", function (event) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = [...group.querySelectorAll('[role="tab"]')];
        const index = tabs.indexOf(document.activeElement);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      });
    });
    window.addEventListener("storage", function (event) {
      if (event.key === "testy.currentDemoId") {
        demoRefreshGeneration++;
        demoPasswordVisible = false;
        currentDemoId = event.newValue || "";
        clearDemoResults();
        currentDemo = undefined;
        demoSelectorsSessionId = "";
        void refreshDemoSession();
      } else if (event.key === "testy.demoSessionTab") {
        chooseDemoSessionTab(event.newValue || "active");
      }
    });
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
    chooseDemoSessionTab(demoSessionTab);
    if (document.getElementById("interactiveMode").classList.contains("active")) {
      void refreshDemoSession();
    } else {
      void refreshDemoList();
    }
    setInterval(function () { if (!document.hidden) void refreshHealth(); }, 7000);
  </script>
</body>
</html>`;
