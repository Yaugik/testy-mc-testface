import { join } from "node:path";

import { fingerprintUrl } from "@testy/browser-runner";
import type {
  ScenarioActionContext,
  ScenarioActionRegistry,
} from "@testy/scenario-engine";

import { persistArtifact, toPersistedCall } from "./evidence.js";
import type { RunState } from "./state.js";
import type {
  PlatformActionDependencies,
  PlatformActionOptions,
} from "./types.js";
import {
  ledgerKey,
  readObject,
  readSafeRelativeName,
  readString,
  requireRuntime,
  requireVendor,
  safeChild,
  safeSegment,
  sanitizeUnknown,
} from "./util.js";

export function createVendorActions(
  options: PlatformActionOptions,
  dependencies: PlatformActionDependencies,
  stateFor: (context: ScenarioActionContext) => RunState,
): ScenarioActionRegistry {
  return {
    "vendor.compile": async (input, context) => {
      const value = readObject(input);
      const packageName = readSafeRelativeName(value, "package");
      const packagePath = safeChild(options.vendorPackagesRoot, packageName);
      const privacy =
        await dependencies.validateVendorPackagePrivacy(packagePath);
      const loaded = await dependencies.loadVendorPackage(packagePath);
      const compiled = dependencies.compileVendorBundle(loaded, {
        ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
        runNamespace: context.runId as string,
      });
      const bundle = await dependencies.writeVendorBundle(
        compiled,
        join(
          options.generatedRoot,
          safeSegment(context.runId as string),
          "vendors",
        ),
      );
      const vendorId = bundle.manifest.vendor.id;
      stateFor(context).vendors.set(vendorId, {
        packageName,
        bundle,
        runtimeLeaseRegistered: false,
        recordedCalls: new Set(),
      });
      await persistArtifact(
        options.evidence,
        context,
        "vendor-manifest",
        bundle.manifestPath,
        { vendorId, bundleId: bundle.bundleId },
      );
      await persistArtifact(
        options.evidence,
        context,
        "vendor-source-map",
        bundle.sourceMapPath,
        { vendorId, bundleId: bundle.bundleId },
      );
      return {
        vendorId,
        bundleId: bundle.bundleId,
        warningCount: bundle.manifest.warnings.length,
        privacyScannedFiles: privacy.scannedFiles,
      };
    },

    "vendor.start-runtime": async (input, context) => {
      const value = readObject(input);
      const vendorId = readString(value, "vendorId");
      const vendor = requireVendor(stateFor(context), vendorId);
      if (!vendor.runtime) {
        vendor.runtime = await dependencies.startVendorRuntime(vendor.bundle, {
          signal: context.signal,
          containerName: `testy-${safeSegment(context.runId as string)}-${safeSegment(vendorId)}`,
          ...(options.runtimeNetworkName
            ? { networkName: options.runtimeNetworkName }
            : {}),
        });
      }
      const runtime = vendor.runtime;
      if (!vendor.runtimeLeaseRegistered) {
        await context.registerResourceLease(
          "vendor-runtime",
          runtime.containerId,
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          async () => {
            await runtime.stop();
            if (vendor.runtime === runtime) vendor.runtime = undefined;
          },
        );
        vendor.runtimeLeaseRegistered = true;
      }
      await options.evidence.recordObservation({
        observationId: `runtime-ready-${vendorId}`,
        runId: context.runId,
        observationType: "vendor-runtime-ready",
        status: "ready",
        value: {
          vendorId,
          bundleId: vendor.bundle.bundleId,
          providerBaseUrlFingerprint: fingerprintUrl(runtime.providerBaseUrl),
        },
        metadata: {},
        observedAt: new Date().toISOString(),
      });
      return {
        vendorId,
        providerBaseUrl: runtime.providerBaseUrl,
        bundleId: vendor.bundle.bundleId,
      };
    },

    "vendor.collect-ledger": async (input, context) => {
      const value = readObject(input);
      const vendorId = readString(value, "vendorId");
      const vendor = requireVendor(stateFor(context), vendorId);
      const ledger = await requireRuntime(vendor, vendorId).collectLedger();
      let recorded = 0;
      for (const entry of ledger) {
        const key = ledgerKey(entry);
        if (vendor.recordedCalls.has(key)) continue;
        vendor.recordedCalls.add(key);
        await options.evidence.recordProviderCall(
          toPersistedCall(context, entry),
        );
        recorded += 1;
      }
      const unmatchedCalls = ledger.filter((entry) => entry.unmatched).length;
      await options.evidence.recordObservation({
        observationId: `provider-ledger-${vendorId}`,
        runId: context.runId,
        observationType: "provider-ledger-summary",
        status: "completed",
        value: {
          vendorId,
          totalCalls: ledger.length,
          newlyRecordedCalls: recorded,
          unmatchedCalls,
        },
        metadata: {},
        observedAt: new Date().toISOString(),
      });
      return {
        vendorId,
        totalCalls: ledger.length,
        newlyRecordedCalls: recorded,
        unmatchedCalls,
      };
    },

    "vendor.collect-state": async (input, context) => {
      const value = readObject(input);
      const vendorId = readString(value, "vendorId");
      const vendor = requireVendor(stateFor(context), vendorId);
      const snapshot = await requireRuntime(vendor, vendorId).stateSnapshot();
      await options.evidence.recordObservation({
        observationId: `provider-state-${vendorId}`,
        runId: context.runId,
        observationType: "provider-runtime-state",
        status: snapshot ? "completed" : "not-applicable",
        ...(snapshot
          ? {
              value: {
                vendorId,
                ...(snapshot.currentState
                  ? { currentState: snapshot.currentState }
                  : {}),
                counters: sanitizeUnknown(snapshot.counters),
                sequences: sanitizeUnknown(snapshot.sequences),
              },
            }
          : {}),
        metadata: {},
        observedAt: new Date().toISOString(),
      });
      return snapshot
        ? {
            vendorId,
            ...(snapshot.currentState
              ? { currentState: snapshot.currentState }
              : {}),
          }
        : { vendorId, available: false };
    },
  };
}
