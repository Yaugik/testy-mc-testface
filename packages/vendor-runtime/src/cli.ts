#!/usr/bin/env node
import { resolve } from "node:path";

import { loadVendorPackage } from "@testy/config-loader";
import {
  compileVendorBundle,
  writeVendorBundle,
} from "@testy/vendor-compiler";

import { DockerCliContainerEngine } from "./docker-cli-engine.js";
import { ImposterRuntimeManager } from "./runtime-manager.js";

const [vendorPath = "vendors/ipinfo", outputRoot = "generated/runtime"] =
  process.argv.slice(2);
const loaded = await loadVendorPackage(resolve(vendorPath));
const compiled = compileVendorBundle(loaded, {
  ...(process.env.TESTY_IMPOSTER_IMAGE
    ? { runtimeImage: process.env.TESTY_IMPOSTER_IMAGE }
    : {}),
  ...(process.env.TESTY_RUN_NAMESPACE
    ? { runNamespace: process.env.TESTY_RUN_NAMESPACE }
    : {}),
});
const bundle = await writeVendorBundle(compiled, resolve(outputRoot));
const runtime = await new ImposterRuntimeManager(
  new DockerCliContainerEngine(),
).start(bundle);

process.stdout.write(
  `${JSON.stringify(
    {
      bundleId: bundle.bundleId,
      containerId: runtime.containerId,
      baseUrl: runtime.baseUrl,
      providerBaseUrl: runtime.providerBaseUrl,
      status: runtime.status,
    },
    null,
    2,
  )}\n`,
);

let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) {
    return;
  }
  stopping = true;
  await runtime.stop();
};

process.once("SIGINT", () => {
  void stop().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  void stop().finally(() => process.exit(143));
});
