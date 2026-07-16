import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BrowserPackageValidationError, loadBrowserPackage, resolveJourney } from "../src/index.js";

const fixturePath = resolve(import.meta.dirname, "../../../customers/customer-alpha");

describe("browser package loader", () => {
  it("loads and deterministically resolves the sample customer", async () => {
    const first = await loadBrowserPackage(fixturePath);
    const second = await loadBrowserPackage(fixturePath);
    const resolved = resolveJourney(first, "lead-capture");

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.site.site.hostname).toBe("customer-alpha.test");
    expect(resolved.steps).toHaveLength(13);
    expect(resolved.steps.find((step) => step.id === "fill-email")?.value).toBe(
      "qa@nordlicht.example",
    );
    expect(resolved.artifactPolicy.trace).toBe("always");
  });

  it("rejects positional CSS selectors", async () => {
    const root = await mkdtemp(join(tmpdir(), "testy-browser-"));
    await cp(fixturePath, root, { recursive: true });
    const journeyPath = join(root, "journeys/lead-capture.yaml");
    const content = await readFile(journeyPath, "utf8");
    await writeFile(
      journeyPath,
      content.replace(
        "selector:\n      testId: hero-heading",
        "selector:\n      css: main > h1:nth-child(1)",
      ).replace("timeoutMs: 60000", "timeoutMs: 60000\nallowCssFallback: true"),
    );

    await expect(loadBrowserPackage(root)).rejects.toBeInstanceOf(
      BrowserPackageValidationError,
    );
  });
});
