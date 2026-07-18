import { describe, expect, it } from "vitest";

import { deriveTargetOutcome } from "../src/target-outcome.js";

describe("deriveTargetOutcome", () => {
  it("derives primary and control tenant visibility without fixed IDs", () => {
    const result = deriveTargetOutcome(
      {
        tenantId: "tenant-alpha-run",
        visibleTenantIds: ["tenant-alpha-run"],
        scoreCount: 1,
        companyCount: 1,
      },
      {
        "prepare-target": {
          targetRunId: "target-run",
          tenantId: "tenant-alpha-run",
          controlTenantId: "tenant-beta-run",
          trackingScriptUrl: "https://tracking.example.test/script.js",
        },
      },
    );
    expect(result).toMatchObject({
      primaryTenantVisible: true,
      controlTenantConfigured: true,
      controlTenantVisible: false,
    });
  });
});
