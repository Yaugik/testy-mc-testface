import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileVendorPackage, loadVendorPackage } from "../src/index.js";

const temporaryDirectories: string[] = [];
const vendorDirectory = resolve(process.cwd(), "../../vendors/ipinfo");

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("vendor compiler", () => {
  it("loads the minimal IPinfo package", async () => {
    const loaded = await loadVendorPackage(vendorDirectory);

    expect(loaded.vendor.vendor.id).toBe("ipinfo");
    expect(loaded.cases.cases.map((systemCase) => systemCase.id)).toEqual([
      "corporate-ip",
    ]);
  });

  it("produces deterministic manifests and Imposter configuration", async () => {
    const first = await mkdtemp(join(tmpdir(), "testy-compile-first-"));
    const second = await mkdtemp(join(tmpdir(), "testy-compile-second-"));
    temporaryDirectories.push(first, second);

    const firstResult = await compileVendorPackage(vendorDirectory, first);
    const secondResult = await compileVendorPackage(vendorDirectory, second);

    expect(firstResult.contentHash).toBe(secondResult.contentHash);
    expect(await readFile(firstResult.manifestFile, "utf8")).toBe(
      await readFile(secondResult.manifestFile, "utf8"),
    );
    expect(await readFile(firstResult.imposterConfigFile, "utf8")).toContain(
      "corporate-ip",
    );
  });
});
