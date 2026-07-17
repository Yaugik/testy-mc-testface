import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { RunId } from "@testy/shared-types";
import type {
  PersistedArtifact,
  PersistedBrowserAction,
  PersistedProviderCall,
  ScenarioActionContext,
  ScenarioValue,
} from "@testy/scenario-engine";
import { describe, expect, it } from "vitest";

import { createIntegratedPlatformActions } from "../src/index.js";

describe("createIntegratedPlatformActions", () => {
  it("connects vendor, site, browser, target delegates, evidence and cleanup", async () => {
    const root = join(tmpdir(), `testy-platform-actions-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const manifestPath = join(root, "manifest.json");
    const sourceMapPath = join(root, "source-map.json");
    const browserRoot = join(root, "browser");
    const browserReportPath = join(browserRoot, "report.json");
    await mkdir(browserRoot, { recursive: true });
    await writeFile(manifestPath, "{}\n");
    await writeFile(sourceMapPath, "{}\n");
    await writeFile(browserReportPath, "{}\n");

    const artifacts: PersistedArtifact[] = [];
    const providerCalls: PersistedProviderCall[] = [];
    const browserActions: PersistedBrowserAction[] = [];
    const observations: unknown[] = [];
    const cleanups: Array<() => Promise<void>> = [];
    const leases: string[] = [];
    let configuredEndpoints: ScenarioValue | undefined;
    let configuredSite: ScenarioValue | undefined;
    let runtimeStopped = false;
    let siteStopped = false;

    const bundle = createIntegratedPlatformActions({
      vendorPackagesRoot: root,
      browserPackagesRoot: root,
      generatedRoot: root,
      evidence: {
        addArtifact: async (artifact: PersistedArtifact) =>
          void artifacts.push(artifact),
        recordProviderCall: async (record: PersistedProviderCall) =>
          void providerCalls.push(record),
        recordBrowserAction: async (record: PersistedBrowserAction) =>
          void browserActions.push(record),
        recordObservation: async (record: unknown) =>
          void observations.push(record),
      } as never,
      delegates: {
        configureVendorEndpoints: async (input) => {
          configuredEndpoints = input;
          return { configured: true };
        },
        configureSyntheticSite: async (input) => {
          configuredSite = input;
          return { configured: true };
        },
      },
      dependencies: {
        loadVendorPackage: async () =>
          ({ executionModel: { vendor: { id: "ipinfo" } } }) as never,
        compileVendorBundle: () =>
          ({
            bundleId: "bundle-ipinfo",
            manifest: { vendor: { id: "ipinfo" }, warnings: [] },
          }) as never,
        writeVendorBundle: async () =>
          ({
            bundleId: "bundle-ipinfo",
            manifest: { vendor: { id: "ipinfo" }, warnings: [] },
            manifestPath,
            sourceMapPath,
          }) as never,
        startVendorRuntime: async () =>
          ({
            containerId: "container-ipinfo",
            providerBaseUrl: "http://127.0.0.1:41001/ipinfo",
            collectLedger: async () => [
              {
                vendorId: "ipinfo",
                operationId: "lookup-ip",
                caseId: "known-ip",
                unmatched: false,
                statusCode: 200,
                timestamp: "2026-07-17T00:00:00.000Z",
              },
            ],
            stateSnapshot: async () => ({
              currentState: "ready",
              counters: { requests: 1 },
              sequences: {},
            }),
            stop: async () => {
              runtimeStopped = true;
            },
          }) as never,
        loadBrowserPackage: async () =>
          ({
            customer: { customer: { id: "customer-alpha" } },
            site: { site: { id: "alpha-site" } },
            journeys: [{ journey: { id: "lead-capture" } }],
            contentHash: "b".repeat(64),
          }) as never,
        startSyntheticSite: async () =>
          ({
            hostname: "run.customer-alpha.example.test",
            port: 42001,
            origin: "http://run.customer-alpha.example.test:42001",
            localOrigin: "http://127.0.0.1:42001",
            siteId: "alpha-site",
            events: () => [
              {
                type: "form-submit",
                formId: "lead",
                fieldNames: ["company"],
                bodyFingerprint: "c".repeat(64),
              },
            ],
            stop: async () => {
              siteStopped = true;
            },
          }) as never,
        runBrowserJourney: async () => ({
          customerId: "customer-alpha",
          siteId: "alpha-site",
          journeyId: "lead-capture",
          contentHash: "d".repeat(64),
          browser: "chromium",
          status: "passed",
          startedAt: "2026-07-17T00:00:01.000Z",
          completedAt: "2026-07-17T00:00:02.000Z",
          actions: [
            {
              stepId: "submit",
              action: "submit",
              status: "passed",
              startedAt: "2026-07-17T00:00:01.000Z",
              completedAt: "2026-07-17T00:00:02.000Z",
              durationMs: 1000,
            },
          ],
          console: [],
          requests: [],
          artifacts: { rootDirectory: browserRoot, screenshots: [] },
        }),
      },
    });

    const context: ScenarioActionContext = {
      runId: "00000000-0000-4000-8000-000000000100" as RunId,
      scenarioId: "vertical-smoke" as never,
      target: "gl-eye",
      variables: {},
      outputs: {},
      signal: new AbortController().signal,
      registerCleanup: (_name, cleanup) => void cleanups.push(cleanup),
      registerResourceLease: async (type, key, _expiresAt, cleanup) => {
        leases.push(`${type}:${key}`);
        cleanups.push(cleanup);
        return {} as never;
      },
    };

    await bundle.actions["vendor.compile"]?.({ package: "ipinfo" }, context);
    await bundle.actions["vendor.start-runtime"]?.(
      { vendorId: "ipinfo" },
      context,
    );
    await bundle.actions["platform.configure-target-vendors"]?.(
      undefined,
      context,
    );
    await bundle.actions["browser.load-package"]?.(
      { package: "customer-alpha" },
      context,
    );
    await bundle.actions["site.start"]?.(undefined, context);
    await bundle.actions["platform.configure-target-site"]?.(
      undefined,
      context,
    );
    await bundle.actions["browser.run-journey"]?.(
      { journeyId: "lead-capture" },
      context,
    );
    await bundle.actions["browser.collect-site-events"]?.(undefined, context);
    await bundle.actions["vendor.collect-ledger"]?.(
      { vendorId: "ipinfo" },
      context,
    );
    await bundle.actions["vendor.collect-state"]?.(
      { vendorId: "ipinfo" },
      context,
    );

    expect(configuredEndpoints).toMatchObject({
      endpoints: { ipinfo: "http://127.0.0.1:41001/ipinfo" },
    });
    expect(configuredSite).toMatchObject({
      siteId: "alpha-site",
      hostname: "run.customer-alpha.example.test",
    });
    expect(leases).toEqual([
      "vendor-runtime:container-ipinfo",
      "synthetic-site:run.customer-alpha.example.test:42001",
    ]);
    expect(providerCalls).toHaveLength(1);
    expect(browserActions).toHaveLength(1);
    expect(artifacts.map((artifact) => artifact.kind)).toEqual([
      "vendor-manifest",
      "vendor-source-map",
      "browser-report",
    ]);
    expect(observations.length).toBeGreaterThanOrEqual(5);

    for (const cleanup of [...cleanups].reverse()) await cleanup();
    expect(runtimeStopped).toBe(true);
    expect(siteStopped).toBe(true);
  });
});
