import { loadBrowserPackage, resolveJourney } from "@testy/browser-config";
import { runBrowserJourney } from "@testy/browser-runner";
import { loadVendorPackage } from "@testy/config-loader";
import { validateVendorPackagePrivacy } from "@testy/privacy-validation";
import type { ScenarioActionContext } from "@testy/scenario-engine";
import { startSyntheticSite } from "@testy/synthetic-site-host";
import { compileVendorBundle, writeVendorBundle } from "@testy/vendor-compiler";
import {
  DockerCliContainerEngine,
  ImposterRuntimeManager,
} from "@testy/vendor-runtime";

import { createBrowserActions } from "./browser-actions.js";
import type { RunState } from "./state.js";
import type {
  PlatformActionBundle,
  PlatformActionDependencies,
  PlatformActionOptions,
} from "./types.js";
import { createVendorActions } from "./vendor-actions.js";

export function createIntegratedPlatformActions(
  options: PlatformActionOptions,
): PlatformActionBundle {
  const engine = options.containerEngine ?? new DockerCliContainerEngine();
  const manager = new ImposterRuntimeManager(engine);
  const dependencies: PlatformActionDependencies = {
    validateVendorPackagePrivacy,
    loadVendorPackage,
    compileVendorBundle,
    writeVendorBundle,
    startVendorRuntime: (bundle, startOptions) =>
      manager.start(bundle, startOptions),
    loadBrowserPackage,
    startSyntheticSite,
    runBrowserJourney: async (journeyId, loaded, site, runnerOptions) =>
      runBrowserJourney(resolveJourney(loaded, journeyId), site, runnerOptions),
    ...options.dependencies,
  };
  const states = new Map<string, RunState>();
  const stateFor = (context: ScenarioActionContext): RunState => {
    const key = context.runId as string;
    let state = states.get(key);
    if (!state) {
      state = {
        vendors: new Map(),
        browserReports: new Map(),
        siteLeaseRegistered: false,
        cleanupRegistered: false,
      };
      states.set(key, state);
    }
    if (!state.cleanupRegistered) {
      state.cleanupRegistered = true;
      context.registerCleanup("platform-run-state", async () => {
        states.delete(key);
      });
    }
    return state;
  };

  return {
    actions: {
      ...createVendorActions(options, dependencies, stateFor),
      ...createBrowserActions(options, dependencies, stateFor),
    },
    resourceCleaners: {
      "vendor-runtime": async (lease) => engine.remove(lease.resourceKey),
      "synthetic-site": async () => undefined,
    },
  };
}
