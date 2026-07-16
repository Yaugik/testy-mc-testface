#!/usr/bin/env node
import { resolve } from "node:path";

import { loadVendorPackage } from "@testy/config-loader";
import {
  compileVendorBundle,
  writeVendorBundle,
} from "@testy/vendor-compiler";

import { DockerCliContainerEngine } from "./docker-cli-engine.js";
import { ImposterRuntimeManager } from "./runtime-manager.js";
import { runStatefulRuntimeSmoke } from "./stateful-smoke.js";

const [vendorPath = "vendors/ipinfo", outputRoot = "generated/smoke"] =
  process.argv.slice(2);
const loaded = await loadVendorPackage(resolve(vendorPath));
const compiled = compileVendorBundle(loaded, {
  ...(process.env.TESTY_IMPOSTER_IMAGE
    ? { runtimeImage: process.env.TESTY_IMPOSTER_IMAGE }
    : {}),
  runNamespace: process.env.TESTY_RUN_NAMESPACE ?? "stateful-smoke",
});
const bundle = await writeVendorBundle(compiled, resolve(outputRoot));
const runtime = await new ImposterRuntimeManager(
  new DockerCliContainerEngine(),
).start(bundle);

try {
  const report = await runStatefulRuntimeSmoke(
    runtime,
    {
      authenticationHeaders: {
        Authorization: "Bearer test-token-valid",
      },
      recovery: {
        path: "/198.51.100.61",
        caseId: "transient-recovery",
        logicalStore: "recovery",
        attemptsKey: "attempts",
        outcomeKey: "last-outcome",
        recoveredOutcome: "recovered",
        expectedSequenceIndexes: [0, 1, 2, 2],
      },
      stateTransition: {
        triggerPath: "/198.51.100.70",
        triggerCaseId: "enter-unavailable",
        probePath: "/198.51.100.10",
        probeCaseId: "corporate-high-confidence",
        unavailableState: "unavailable",
        healthyState: "healthy",
        requestsBeforeRecovery: 3,
      },
    },
    {
      correlationPrefix:
        process.env.TESTY_SMOKE_CORRELATION_PREFIX ??
        "ipinfo-stateful-smoke",
    },
  );

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) {
    process.exitCode = 1;
  }
} finally {
  await runtime.stop();
}
