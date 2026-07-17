import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("platform execution configuration", () => {
  it("loads deterministic local execution defaults", () => {
    const config = loadConfig({});
    expect(config.vendorPackagesDirectory).toBe("vendors");
    expect(config.browserPackagesDirectory).toBe("customers");
    expect(config.generatedRunsDirectory).toBe("generated/runs");
    expect(config.browser).toBe("chromium");
    expect(config.browserHeadless).toBe(true);
  });

  it("accepts explicit browser and execution paths", () => {
    const config = loadConfig({
      VENDOR_PACKAGES_DIR: "/workspace/vendors",
      BROWSER_PACKAGES_DIR: "/workspace/customers",
      GENERATED_RUNS_DIR: "/workspace/generated",
      TESTY_BROWSER: "firefox",
      TESTY_HEADLESS: "false",
      TESTY_IMPOSTER_IMAGE: "registry.example.test/imposter@sha256:abc",
    });
    expect(config.browser).toBe("firefox");
    expect(config.browserHeadless).toBe(false);
    expect(config.runtimeImage).toContain("@sha256:");
  });

  it("rejects invalid browser controls", () => {
    expect(() => loadConfig({ TESTY_BROWSER: "opera" })).toThrow(
      /TESTY_BROWSER/u,
    );
    expect(() => loadConfig({ TESTY_HEADLESS: "sometimes" })).toThrow(
      /TESTY_HEADLESS/u,
    );
  });
});
