import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadVendorContractSuite } from "../src/loader.js";

const vendorsRoot = resolve(import.meta.dirname, "../../../vendors");

describe("loadVendorContractSuite", () => {
  for (const vendorId of ["ipinfo", "apollo", "hunter"] as const) {
    it(`loads the ${vendorId} contract suite`, async () => {
      const suite = await loadVendorContractSuite(
        resolve(vendorsRoot, vendorId),
      );
      expect(suite.suiteId).toBe(`${vendorId}-contract`);
      expect(suite.cases.length).toBeGreaterThan(0);
    });
  }
});
