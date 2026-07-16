#!/usr/bin/env node
import { resolve } from "node:path";

import { loadVendorPackage } from "@testy/config-loader";
import { validateVendorPackagePrivacy } from "@testy/privacy-validation";
import { compileVendorBundle, writeVendorBundle } from "@testy/vendor-compiler";
import {
  DockerCliContainerEngine,
  ImposterRuntimeManager,
  type RunningVendorRuntime,
} from "@testy/vendor-runtime";

import { runVendorIsolationSuite } from "./hardening-runner.js";
import { loadVendorContractSuite } from "./loader.js";

const [vendorPath = "vendors/ipinfo", outputRoot = "generated/isolation"] = process.argv.slice(2);
const packagePath = resolve(vendorPath);
await validateVendorPackagePrivacy(packagePath);
const loaded = await loadVendorPackage(packagePath);
const suite = await loadVendorContractSuite(packagePath);
if (!suite.isolation) throw new Error(`Vendor contract suite '${suite.suiteId}' has no isolation definition.`);

const runtimeImage = process.env.TESTY_IMPOSTER_IMAGE;
const leftCompiled = compileVendorBundle(loaded, {
  runNamespace: `${suite.suiteId}-isolation-left`,
  ...(runtimeImage ? { runtimeImage } : {}),
});
const rightCompiled = compileVendorBundle(loaded, {
  runNamespace: `${suite.suiteId}-isolation-right`,
  ...(runtimeImage ? { runtimeImage } : {}),
});
const [leftBundle, rightBundle] = await Promise.all([
  writeVendorBundle(leftCompiled, resolve(outputRoot, loaded.executionModel.vendor.id, "left")),
  writeVendorBundle(rightCompiled, resolve(outputRoot, loaded.executionModel.vendor.id, "right")),
]);

const manager = new ImposterRuntimeManager(new DockerCliContainerEngine());
let leftRuntime: RunningVendorRuntime | undefined;
let rightRuntime: RunningVendorRuntime | undefined;
try {
  leftRuntime = await manager.start(leftBundle);
  rightRuntime = await manager.start(rightBundle);
  const report = await runVendorIsolationSuite(leftRuntime, rightRuntime, suite);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
} finally {
  await Promise.allSettled([
    leftRuntime?.stop() ?? Promise.resolve(),
    rightRuntime?.stop() ?? Promise.resolve(),
  ]);
}
