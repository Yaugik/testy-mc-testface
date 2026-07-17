import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { RunId } from "@testy/shared-types";
import type { ScenarioActionContext } from "@testy/scenario-engine";
import { describe, expect, it } from "vitest";

import { createIntegratedPlatformActions } from "../src/index.js";

describe("integrated platform action isolation", () => {
  it("isolates two concurrent runs and leaves no active resources", async () => {
    const root = join(tmpdir(), `testy-platform-concurrency-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const manifestPath = join(root, "manifest.json");
    const sourceMapPath = join(root, "source-map.json");
    await writeFile(manifestPath, "{}\n");
    await writeFile(sourceMapPath, "{}\n");

    let sequence = 0;
    const stoppedRuntimes = new Set<string>();
    const stoppedSites = new Set<string>();
    const configured = new Map<string, string>();
    const bundle = createIntegratedPlatformActions({
      vendorPackagesRoot: root,
      browserPackagesRoot: root,
      generatedRoot: root,
      evidence: {
        addArtifact: async () => undefined,
        recordProviderCall: async () => undefined,
        recordBrowserAction: async () => undefined,
        recordObservation: async () => undefined,
      } as never,
      delegates: {
        configureVendorEndpoints: async (input, context) => {
          const endpoints = (input as { endpoints: { ipinfo: string } }).endpoints;
          configured.set(context.runId, endpoints.ipinfo);
          return { configured: true };
        },
      },
      dependencies: {
        validateVendorPackagePrivacy: async () => ({ passed: true, scannedFiles: 1 }),
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
        startVendorRuntime: async () => {
          const id = `runtime-${++sequence}`;
          return {
            containerId: id,
            providerBaseUrl: `http://127.0.0.1:${41000 + sequence}/ipinfo`,
            stop: async () => void stoppedRuntimes.add(id),
          } as never;
        },
        loadBrowserPackage: async () =>
          ({
            customer: { customer: { id: "customer-alpha" } },
            site: { site: { id: "alpha-site" } },
            journeys: [],
            contentHash: "b".repeat(64),
          }) as never,
        startSyntheticSite: async (_loaded, options) => {
          const hostname = `${options.runNamespace}.customer-alpha.example.test`;
          return {
            hostname,
            port: 42000 + sequence,
            origin: `http://${hostname}:${42000 + sequence}`,
            localOrigin: `http://127.0.0.1:${42000 + sequence}`,
            siteId: "alpha-site",
            events: () => [],
            stop: async () => void stoppedSites.add(hostname),
          } as never;
        },
      },
    });

    const contexts = [
      createContext("00000000-0000-4000-8000-000000000201" as RunId),
      createContext("00000000-0000-4000-8000-000000000202" as RunId),
    ];
    await Promise.all(contexts.map(async ({ context }) => {
      await bundle.actions["vendor.compile"]?.({ package: "ipinfo" }, context);
      await bundle.actions["vendor.start-runtime"]?.({ vendorId: "ipinfo" }, context);
      await bundle.actions["browser.load-package"]?.({ package: "customer-alpha" }, context);
      await bundle.actions["site.start"]?.(undefined, context);
      await bundle.actions["platform.configure-target-vendors"]?.(undefined, context);
    }));

    expect(bundle.diagnostics.activeRunIds()).toEqual(
      contexts.map(({ context }) => context.runId).sort(),
    );
    expect(new Set(configured.values()).size).toBe(2);

    await Promise.all(contexts.map(async ({ cleanups }) => {
      for (const cleanup of [...cleanups].reverse()) await cleanup();
    }));

    expect(bundle.diagnostics.activeRunIds()).toEqual([]);
    expect(stoppedRuntimes.size).toBe(2);
    expect(stoppedSites.size).toBe(2);
  });
});

function createContext(runId: RunId): {
  readonly context: ScenarioActionContext;
  readonly cleanups: Array<() => Promise<void>>;
} {
  const cleanups: Array<() => Promise<void>> = [];
  return {
    cleanups,
    context: {
      runId,
      scenarioId: "concurrent-acceptance" as never,
      target: "gl-eye",
      variables: {},
      outputs: {},
      signal: new AbortController().signal,
      registerCleanup: (_name, cleanup) => void cleanups.push(cleanup),
      registerResourceLease: async (_type, _key, _expiresAt, cleanup) => {
        cleanups.push(cleanup);
        return {} as never;
      },
    },
  };
}
