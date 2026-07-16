import { resolve } from "node:path";

import { loadBrowserPackage } from "@testy/browser-config";
import { describe, expect, it } from "vitest";

import { startSyntheticSite } from "../src/index.js";

const fixturePath = resolve(import.meta.dirname, "../../../customers/customer-alpha");

describe("synthetic site host", () => {
  it("serves deterministic pages and records privacy-safe form events", async () => {
    const loaded = await loadBrowserPackage(fixturePath);
    const binding = await startSyntheticSite(loaded, { runNamespace: "run-123" });

    try {
      const health = await fetch(`${binding.localOrigin}/__testy/health`);
      expect(await health.json()).toEqual({ status: "ok", siteId: "alpha-marketing-site" });

      const home = await fetch(`${binding.localOrigin}/`);
      const html = await home.text();
      expect(html).toContain('data-test="hero-heading"');
      expect(html).toContain("Nordlicht Example GmbH");
      expect(binding.hostname).toBe("run-123.customer-alpha.test");

      const form = await fetch(`${binding.localOrigin}/contact/submit`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "work_email=qa%40nordlicht.example&company_size=medium",
        redirect: "manual",
      });
      expect(form.status).toBe(303);
      expect(form.headers.get("location")).toBe("/thanks");

      const submission = binding.events().find((event) => event.type === "form-submit");
      expect(submission).toMatchObject({
        formId: "lead-form",
        fieldNames: ["company_size", "work_email"],
      });
      expect(JSON.stringify(submission)).not.toContain("qa@nordlicht.example");
    } finally {
      await binding.stop();
    }
  });
});
