import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadVendorPackage } from "../src/loader.js";

const fixturePath = resolve(import.meta.dirname, "../../../vendors/ipinfo");

describe("loadVendorPackage", () => {
  it("loads the IPinfo package into a deterministic execution model", async () => {
    const first = await loadVendorPackage(fixturePath);
    const second = await loadVendorPackage(fixturePath);

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.executionModel.vendor.id).toBe("ipinfo");
    expect(first.executionModel.system.initialState).toBe("healthy");
    expect(first.executionModel.operations).toHaveLength(1);
    expect(first.executionModel.operations[0]?.cases.map((item) => item.id)).toEqual([
      "corporate-high-confidence",
      "residential",
      "unknown",
      "timeout",
    ]);
  });

  it("reports a missing referenced response asset", async () => {
    const copy = await mkdtemp(join(tmpdir(), "testy-vendor-"));
    await copyFixture(fixturePath, copy);
    const vendorFile = join(copy, "vendor.yaml");
    const content = await readFile(vendorFile, "utf8");
    await writeFile(
      vendorFile,
      content.replace("responses/not-found.json", "responses/missing.json"),
      "utf8",
    );

    await expect(loadVendorPackage(copy)).rejects.toMatchObject({
      name: "VendorPackageValidationError",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "asset-invalid" }),
      ]),
    });
  });
});

async function copyFixture(source: string, destination: string): Promise<void> {
  const { cp } = await import("node:fs/promises");
  await cp(source, destination, { recursive: true });
}
