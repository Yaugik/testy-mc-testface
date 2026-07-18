import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { fingerprintText, fingerprintUrl } from "@testy/browser-runner";
import type {
  PersistedArtifact,
  PersistedBrowserAction,
  PersistedProviderCall,
  ScenarioActionContext,
  ScenarioRunRepository,
  ScenarioValue,
} from "@testy/scenario-engine";
import type { ProviderCallLedgerEntry } from "@testy/vendor-runtime";

import type { PlatformActionDependencies } from "./types.js";

export function toPersistedCall(
  context: ScenarioActionContext,
  entry: ProviderCallLedgerEntry,
): PersistedProviderCall {
  return {
    runId: context.runId,
    vendorId: entry.vendorId,
    ...(entry.operationId ? { operationId: entry.operationId } : {}),
    ...(entry.caseId ? { caseId: entry.caseId } : {}),
    ...(entry.correlationId ? { correlationId: entry.correlationId } : {}),
    ...(entry.sequenceIndex === undefined
      ? {}
      : { sequenceIndex: entry.sequenceIndex }),
    ...(entry.statusCode === undefined ? {} : { statusCode: entry.statusCode }),
    ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
    metadata: {
      unmatched: entry.unmatched,
      ...(entry.method ? { method: entry.method } : {}),
      ...(entry.pathFingerprint
        ? { pathFingerprint: entry.pathFingerprint }
        : {}),
      ...(entry.stateBefore ? { stateBefore: entry.stateBefore } : {}),
      ...(entry.stateAfter ? { stateAfter: entry.stateAfter } : {}),
      ...(entry.stateRequestCount === undefined
        ? {}
        : { stateRequestCount: entry.stateRequestCount }),
    },
    occurredAt: entry.timestamp ?? new Date().toISOString(),
  };
}

export async function persistBrowserEvidence(
  evidence: ScenarioRunRepository,
  context: ScenarioActionContext,
  report: Awaited<ReturnType<PlatformActionDependencies["runBrowserJourney"]>>,
): Promise<void> {
  for (const action of report.actions) {
    const record: PersistedBrowserAction = {
      runId: context.runId,
      journeyId: report.journeyId,
      stepId: action.stepId,
      action: action.action,
      status: action.status === "passed" ? "PASSED" : "FAILED",
      durationMs: action.durationMs,
      ...(action.pageUrl
        ? { pageFingerprint: fingerprintUrl(action.pageUrl) }
        : {}),
      metadata: {
        ...(action.error
          ? { errorFingerprint: fingerprintText(action.error) }
          : {}),
        ...(action.screenshotPath
          ? { screenshotName: basename(action.screenshotPath) }
          : {}),
      },
      startedAt: action.startedAt,
      completedAt: action.completedAt,
    };
    await evidence.recordBrowserAction(record);
  }

  await evidence.recordObservation({
    observationId: `browser-journey-${report.journeyId}`,
    runId: context.runId,
    observationType: "browser-journey-summary",
    status: report.status,
    value: {
      journeyId: report.journeyId,
      status: report.status,
      actionCount: report.actions.length,
      failedActionCount: report.actions.filter(
        (action) => action.status === "failed",
      ).length,
      failedRequestCount: report.requests.filter((request) => request.failed)
        .length,
      consoleEntryCount: report.console.length,
    },
    metadata: { browser: report.browser },
    observedAt: report.completedAt,
  });

  await persistArtifact(
    evidence,
    context,
    "browser-report",
    join(report.artifacts.rootDirectory, "report.json"),
    { journeyId: report.journeyId },
  );
  for (const screenshot of report.artifacts.screenshots) {
    await persistArtifact(evidence, context, "browser-screenshot", screenshot, {
      journeyId: report.journeyId,
      name: basename(screenshot),
    });
  }
  if (report.artifacts.tracePath) {
    await persistArtifact(
      evidence,
      context,
      "browser-trace",
      report.artifacts.tracePath,
      { journeyId: report.journeyId },
    );
  }
  if (report.artifacts.selectedHarPath) {
    await persistArtifact(
      evidence,
      context,
      "browser-selected-har",
      report.artifacts.selectedHarPath,
      { journeyId: report.journeyId },
    );
  }
}

export async function persistArtifact(
  evidence: ScenarioRunRepository,
  context: ScenarioActionContext,
  kind: string,
  location: string,
  metadata: Readonly<Record<string, ScenarioValue>>,
): Promise<void> {
  const artifact: PersistedArtifact = {
    artifactId: randomUUID(),
    runId: context.runId,
    kind,
    mediaType: mediaTypeFor(location),
    location,
    sha256: await sha256File(location),
    metadata,
    createdAt: new Date().toISOString(),
  };
  await evidence.addArtifact(artifact);
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function mediaTypeFor(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}
