#!/usr/bin/env node

import { resolve } from "node:path";

import { VendorPackageValidationError } from "./errors.js";
import { loadVendorPackage } from "./loader.js";

const packagePath = process.argv[2];

if (!packagePath) {
  console.error("Usage: testy-vendor <vendor-package-path>");
  process.exitCode = 2;
} else {
  try {
    const loaded = await loadVendorPackage(resolve(packagePath));
    console.log(
      JSON.stringify(
        {
          vendor: loaded.executionModel.vendor,
          contentHash: loaded.contentHash,
          operations: loaded.executionModel.operations.map((operation) => ({
            id: operation.id,
            cases: operation.cases.length,
          })),
          systemStates: loaded.executionModel.system.states.map((state) => state.id),
          assets: loaded.executionModel.assets.map((asset) => asset.relativePath),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (error instanceof VendorPackageValidationError) {
      console.error(error.message);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
