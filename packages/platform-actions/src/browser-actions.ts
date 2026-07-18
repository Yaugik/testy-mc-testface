import { join } from "node:path";

import type {
  ScenarioActionContext,
  ScenarioActionRegistry,
  ScenarioValue,
} from "@testy/scenario-engine";

import { persistBrowserEvidence } from "./evidence.js";
import type { RunState } from "./state.js";
import type {
  PlatformActionDependencies,
  PlatformActionOptions,
} from "./types.js";
import {
  readObject,
  readSafeRelativeName,
  readString,
  requireBrowserPackage,
  requireSite,
  requireRuntime,
  safeChild,
  safeSegment,
} from "./util.js";

export function createBrowserActions(
  options: PlatformActionOptions,
  dependencies: PlatformActionDependencies,
  stateFor: (context: ScenarioActionContext) => RunState,
): ScenarioActionRegistry {
  return {
    "browser.load-package": async (input, context) => {
      const value = readObject(input);
      const packageName = readSafeRelativeName(value, "package");
      const loaded = await dependencies.loadBrowserPackage(
        safeChild(options.browserPackagesRoot, packageName),
      );
      stateFor(context).browserPackage = loaded;
      return {
        customerId: loaded.customer.customer.id,
        siteId: loaded.site.site.id,
        contentHash: loaded.contentHash,
        journeys: loaded.journeys.map((journey) => journey.journey.id).sort(),
      };
    },

    "site.start": async (_input, context) => {
      const state = stateFor(context);
      if (!state.site) {
        state.site = await dependencies.startSyntheticSite(
          requireBrowserPackage(state),
          { runNamespace: context.runId as string },
        );
      }
      if (!state.siteLeaseRegistered) {
        const site = state.site;
        await context.registerResourceLease(
          "synthetic-site",
          `${site.hostname}:${String(site.port)}`,
          new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
          async () => {
            await site.stop();
            if (state.site === site) state.site = undefined;
          },
        );
        state.siteLeaseRegistered = true;
      }
      return {
        siteId: state.site.siteId,
        hostname: state.site.hostname,
        origin: state.site.origin,
        localOrigin: state.site.localOrigin,
      };
    },

    "platform.configure-target-vendors": async (_input, context) => {
      const delegate = options.delegates?.configureVendorEndpoints;
      if (!delegate) {
        throw new Error(
          "Target vendor-endpoint configuration is not available.",
        );
      }
      const endpoints = Object.fromEntries(
        [...stateFor(context).vendors.entries()]
          .map(
            ([vendorId, vendor]) =>
              [
                vendorId,
                requireRuntime(vendor, vendorId).providerBaseUrl,
              ] as const,
          )
          .sort(([left], [right]) => left.localeCompare(right)),
      );
      if (Object.keys(endpoints).length === 0) {
        throw new Error("No vendor runtimes are active for this run.");
      }
      return delegate({ endpoints }, context);
    },

    "platform.configure-target-site": async (_input, context) => {
      const delegate = options.delegates?.configureSyntheticSite;
      if (!delegate) {
        throw new Error(
          "Target synthetic-site configuration is not available.",
        );
      }
      const site = requireSite(stateFor(context));
      return delegate(
        { siteId: site.siteId, hostname: site.hostname },
        context,
      );
    },

    "browser.run-journey": async (input, context) => {
      const value = readObject(input);
      const journeyId = readString(value, "journeyId");
      const executionId = readOptionalString(value, "executionId") ?? "default";
      const targetPreparationStepId = readOptionalString(
        value,
        "targetPreparationStepId",
      );
      const trackingScriptUrl = targetPreparationStepId
        ? readTrackingScriptUrl(context.outputs[targetPreparationStepId])
        : undefined;
      const state = stateFor(context);
      const report = await dependencies.runBrowserJourney(
        journeyId,
        requireBrowserPackage(state),
        requireSite(state),
        {
          ...(options.browser ? { browser: options.browser } : {}),
          ...(options.headless === undefined
            ? {}
            : { headless: options.headless }),
          artifactRoot: join(
            options.generatedRoot,
            safeSegment(context.runId as string),
            "browser",
          ),
          runNamespace: `${context.runId as string}-${safeSegment(executionId)}`,
          signal: context.signal,
          ...(trackingScriptUrl
            ? {
                externalScripts: [trackingScriptUrl],
                expectedRequests: [
                  {
                    id: "target-tracking-script",
                    url: trackingScriptUrl,
                    method: "GET",
                  },
                ],
              }
            : {}),
        },
      );
      state.browserReports.set(executionId, report);
      await persistBrowserEvidence(options.evidence, context, report, {
        executionId,
      });
      return {
        journeyId,
        executionId,
        status: report.status,
        actionCount: report.actions.length,
        failedActionCount: report.actions.filter(
          (action) => action.status === "failed",
        ).length,
        requestCount: report.requests.length,
        requestCheckCount: report.requestChecks?.length ?? 0,
        artifactCount:
          report.artifacts.screenshots.length +
          (report.artifacts.tracePath ? 1 : 0) +
          (report.artifacts.selectedHarPath ? 1 : 0) +
          1,
      };
    },

    "browser.collect-site-events": async (_input, context) => {
      const events = requireSite(stateFor(context)).events();
      const counts = Object.fromEntries(
        ["page-view", "button", "consent", "form-submit"].map((type) => [
          type,
          events.filter((event) => event.type === type).length,
        ]),
      );
      await options.evidence.recordObservation({
        observationId: "synthetic-site-events",
        runId: context.runId,
        observationType: "synthetic-site-events",
        status: "completed",
        value: {
          eventCount: events.length,
          counts,
          forms: events
            .filter((event) => event.type === "form-submit")
            .map((event) => ({
              ...(event.formId ? { formId: event.formId } : {}),
              fieldNames: event.fieldNames ?? [],
              ...(event.bodyFingerprint
                ? { bodyFingerprint: event.bodyFingerprint }
                : {}),
            })),
        },
        metadata: {},
        observedAt: new Date().toISOString(),
      });
      return { eventCount: events.length, counts };
    },
  };
}

function readOptionalString(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): string | undefined {
  const selected = value[key];
  return typeof selected === "string" && selected.length > 0
    ? selected
    : undefined;
}

function readTrackingScriptUrl(value: ScenarioValue | undefined): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Target preparation output is unavailable.");
  }
  const record = value as Readonly<Record<string, ScenarioValue>>;
  const selected = record.trackingScriptUrl;
  if (typeof selected !== "string" || selected.length === 0) {
    throw new Error("Target preparation output did not include a tracking script URL.");
  }
  const url = new URL(selected);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.hash) {
    throw new Error("Target tracking script URL must be an HTTP(S) URL without credentials or a fragment.");
  }
  return url.toString();
}
