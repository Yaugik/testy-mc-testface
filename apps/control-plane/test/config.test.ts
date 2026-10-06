import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("control plane public demo configuration", () => {
  it("normalizes a public demo base URL", () => {
    const config = loadConfig({
      TESTY_PUBLIC_DEMO_BASE_URL: "https://testy.example.com",
    });

    expect(config.publicDemoBaseUrl).toBe("https://testy.example.com");
  });

  it("allows an HTTP base URL for temporary test deployments", () => {
    const config = loadConfig({
      TESTY_PUBLIC_DEMO_BASE_URL: "http://testy.example.com",
    });

    expect(config.publicDemoBaseUrl).toBe("http://testy.example.com");
  });

  it("rejects paths and credentials in the public demo base URL", () => {
    expect(() =>
      loadConfig({
        TESTY_PUBLIC_DEMO_BASE_URL: "https://user:secret@testy.example.com/demo",
      }),
    ).toThrow(/TESTY_PUBLIC_DEMO_BASE_URL/u);
  });
});
