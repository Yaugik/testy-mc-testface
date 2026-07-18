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
    expect(config.runtimeNetworkName).toBeUndefined();
    expect(config.maintenance).toMatchObject({
      intervalMs: 60_000,
      batchSize: 100,
      claimTtlMs: 300_000,
      artifactRetentionMs: 604_800_000,
    });
  });

  it("accepts explicit browser, execution and maintenance controls", () => {
    const config = loadConfig({
      VENDOR_PACKAGES_DIR: "/workspace/vendors",
      BROWSER_PACKAGES_DIR: "/workspace/customers",
      GENERATED_RUNS_DIR: "/workspace/generated",
      TESTY_BROWSER: "firefox",
      TESTY_HEADLESS: "false",
      TESTY_IMPOSTER_IMAGE: "registry.example.test/imposter@sha256:abc",
      TESTY_DOCKER_NETWORK: "testy-platform",
      TESTY_MAINTENANCE_INTERVAL_MS: "0",
      TESTY_MAINTENANCE_BATCH_SIZE: "25",
      TESTY_MAINTENANCE_CLAIM_TTL_MS: "120000",
      TESTY_ARTIFACT_RETENTION_MS: "3600000",
      TESTY_MAINTENANCE_ADMIN_TOKEN: "1234567890abcdef",
    });
    expect(config.browser).toBe("firefox");
    expect(config.browserHeadless).toBe(false);
    expect(config.runtimeImage).toContain("@sha256:");
    expect(config.runtimeNetworkName).toBe("testy-platform");
    expect(config.maintenance).toMatchObject({
      intervalMs: 0,
      batchSize: 25,
      claimTtlMs: 120_000,
      artifactRetentionMs: 3_600_000,
      adminToken: "1234567890abcdef",
    });
  });

  it("rejects invalid browser and maintenance controls", () => {
    expect(() => loadConfig({ TESTY_BROWSER: "opera" })).toThrow(
      /TESTY_BROWSER/u,
    );
    expect(() => loadConfig({ TESTY_HEADLESS: "sometimes" })).toThrow(
      /TESTY_HEADLESS/u,
    );
    expect(() =>
      loadConfig({ TESTY_MAINTENANCE_BATCH_SIZE: "0" }),
    ).toThrow(/TESTY_MAINTENANCE_BATCH_SIZE/u);
    expect(() =>
      loadConfig({ TESTY_MAINTENANCE_ADMIN_TOKEN: "short" }),
    ).toThrow(/TESTY_MAINTENANCE_ADMIN_TOKEN/u);
  });
});
