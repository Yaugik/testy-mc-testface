#!/usr/bin/env node
import { resolve } from "node:path";

import { loadVendorPackage } from "@testy/config-loader";
import { validateVendorPackagePrivacy } from "@testy/privacy-validation";
import { compileVendorBundle, writeVendorBundle } from "@testy/vendor-compiler";
import { DockerCliContainerEngine, ImposterRuntimeManager } from "@testy/vendor-runtime";

import { runHardenedVendorContractSuite } from "./hardening-runner.js";
import { loadVendorContractSuite } from "./loader.js";

const [vendorPath = "vendors/ipinfo", outputRoot = "generated/contracts"] = process.argv.slice(2);
const packagePath = resolve(vendorPath);
await validateVendorPackagePrivacy(packagePath);
const loaded = await loadVendorPackage(packagePath);
const suite = await loadVendorContractSuite(packagePath);
const compiled = compileVendorBundle(loaded, {
  runNamespace: suite.suiteId,
  ...(process.env.TESTY_IMPOSTER_IMAGE ? { runtimeImage: process.env.TESTY_IMPOSTER_IMAGE } : {}),
});
const written = await writeVendorBundle(compiled, resolve(outputRoot, loaded.executionModel.vendor.id));
const runtime = await new ImposterRuntimeManager(new DockerCliContainerEngine()).start(written);
try {
  const report = await runHardenedVendorContractSuite(runtime, suite);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
} finally {
  await runtime.stop();
}
