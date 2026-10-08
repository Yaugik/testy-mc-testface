import { describe, expect, it } from "vitest";

import { isDemoDiagnostic, visitorSelectionChanged } from "../src/ui-state.js";

describe("visitor draft state", () => {
  const applied = { networkId: "corporate", personId: "maya", browserId: "new" };

  it("allows the website to open when all visitor choices match the applied identity", () => {
    expect(visitorSelectionChanged(applied, { ...applied })).toBe(false);
  });

  it.each([
    { networkId: "residential", personId: "maya", browserId: "new" },
    { networkId: "corporate", personId: "", browserId: "new" },
    { networkId: "corporate", personId: "maya", browserId: "returning" },
  ])("marks a changed identity as unapplied: %j", (draft) => {
    expect(visitorSelectionChanged(applied, draft)).toBe(true);
  });

  it("treats omitted and empty anonymous person selections as the same identity", () => {
    expect(
      visitorSelectionChanged(
        { networkId: "residential", browserId: "new" },
        { networkId: "residential", personId: "", browserId: "new" },
      ),
    ).toBe(false);
  });
});

describe("activity presentation", () => {
  it.each([
    "synthetic-site-events",
    "gateway-ledger-summary",
    "provider-ledger-summary",
    "target-outcome",
  ])("groups successful %s polling observations into diagnostics", (name) => {
    expect(isDemoDiagnostic(name, "completed")).toBe(true);
  });

  it.each(["failed", "pending", "unknown"])(
    "keeps %s observations visible in recent activity",
    (status) => {
      expect(isDemoDiagnostic("target-outcome", status)).toBe(false);
    },
  );

  it("keeps meaningful events visible even when completed", () => {
    expect(isDemoDiagnostic("visitor-profile-applied", "completed")).toBe(false);
    expect(isDemoDiagnostic("target-enrichment-incomplete", "completed")).toBe(false);
  });
});
