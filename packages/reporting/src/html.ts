import type { RunReportDocument } from "./types.js";

export function renderRunReportHtml(report: RunReportDocument): string {
  const assertionRows = report.assertions
    .map(
      (result) => `<tr>
<td>${escapeHtml(result.assertionId)}</td>
<td>${escapeHtml(result.type)}</td>
<td>${escapeHtml(result.severity)}</td>
<td>${result.passed ? "PASS" : "FAIL"}</td>
<td>${escapeHtml(result.message)}</td>
</tr>`,
    )
    .join("");
  const stepRows = report.steps
    .map(
      (step) => `<tr>
<td>${escapeHtml(step.stepId)}</td>
<td>${escapeHtml(step.phase)}</td>
<td>${escapeHtml(step.status)}</td>
<td>${String(step.attempt)}</td>
<td>${step.durationMs === undefined ? "" : String(step.durationMs)}</td>
</tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.run.scenarioId)} — Testy report</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;line-height:1.45;color:#171717}
header{display:flex;justify-content:space-between;gap:2rem;align-items:flex-start}
.badge{font-weight:700;padding:.35rem .65rem;border:1px solid currentColor;border-radius:999px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.35rem 1rem}
table{border-collapse:collapse;width:100%;margin:1rem 0 2rem}
th,td{border:1px solid #bbb;padding:.5rem;text-align:left;vertical-align:top}
th{background:#f3f3f3}
code{overflow-wrap:anywhere}
</style>
</head>
<body>
<header>
<div>
<h1>${escapeHtml(report.run.scenarioId)}</h1>
<p>Run <code>${escapeHtml(report.run.runId)}</code></p>
</div>
<div class="badge">${report.summary.passed ? "PASSED" : "FAILED"}</div>
</header>
<dl>
<dt>Target</dt><dd>${escapeHtml(report.run.target)}</dd>
<dt>Status</dt><dd>${escapeHtml(report.run.outcomeStatus ?? report.run.status)}</dd>
<dt>Scenario hash</dt><dd><code>${escapeHtml(report.run.scenarioHash)}</code></dd>
<dt>Report hash</dt><dd><code>${escapeHtml(report.contentHash)}</code></dd>
<dt>Generated</dt><dd>${escapeHtml(report.generatedAt)}</dd>
<dt>Duration</dt><dd>${report.summary.durationMs === undefined ? "n/a" : `${String(report.summary.durationMs)} ms`}</dd>
</dl>
<h2>Summary</h2>
<ul>
<li>Assertions: ${String(report.summary.passedAssertions)} passed, ${String(report.summary.failedAssertions)} failed, ${String(report.summary.warningFailures)} warning failures</li>
<li>Steps: ${String(report.summary.stepCount)} total, ${String(report.summary.failedSteps)} failed</li>
<li>Provider calls: ${String(report.summary.providerCallCount)}</li>
<li>Browser actions: ${String(report.summary.browserActionCount)}</li>
<li>Observations: ${String(report.summary.observationCount)}</li>
<li>Artifacts: ${String(report.summary.artifactCount)}</li>
</ul>
<h2>Assertions</h2>
<table>
<thead><tr><th>ID</th><th>Type</th><th>Severity</th><th>Result</th><th>Message</th></tr></thead>
<tbody>${assertionRows}</tbody>
</table>
<h2>Steps</h2>
<table>
<thead><tr><th>Step</th><th>Phase</th><th>Status</th><th>Attempt</th><th>Duration ms</th></tr></thead>
<tbody>${stepRows}</tbody>
</table>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}
