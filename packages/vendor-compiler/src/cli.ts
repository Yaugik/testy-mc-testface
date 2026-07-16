#!/usr/bin/env node
import { resolve } from "node:path";

import { loadVendorPackage } from "@testy/config-loader";

import { compileVendorBundle } from "./compile.js";
import { writeVendorBundle } from "./writer.js";

const [vendorPath = "vendors/ipinfo", outputRoot = "generated/vendors"] = process.argv.slice(2);
const loaded = await loadVendorPackage(resolve(vendorPath));
const bundle = compileVendorBundle(loaded, {
  ...(process.env.TESTY_IMPOSTER_IMAGE
    ? { runtimeImage: process.env.TESTY_IMPOSTER_IMAGE }
    : {}),
  ...(process.env.TESTY_RUN_NAMESPACE
    ? { runNamespace: process.env.TESTY_RUN_NAMESPACE }
    : {}),
});
const written = await writeVendorBundle(bundle, resolve(outputRoot));

process.stdout.write(
  `${JSON.stringify(
    {
      bundleId: written.bundleId,
      vendor: written.manifest.vendor.id,
      configDirectory: written.configDirectory,
      manifestPath: written.manifestPath,
      warnings: written.manifest.warnings,
    },
    null,
    2,
  )}\n`,
);
