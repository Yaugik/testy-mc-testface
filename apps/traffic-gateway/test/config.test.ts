import { describe, expect, it } from "vitest";

import { loadTrafficGatewayConfig } from "../src/config.js";

describe("traffic gateway config", () => {
  it("requires an admin token and explicit allowlist", () => {
    expect(() => loadTrafficGatewayConfig({})).toThrow(/ADMIN_TOKEN/u);
    const config = loadTrafficGatewayConfig({
      TESTY_GATEWAY_ADMIN_TOKEN: "test-admin-token-1234",
      TESTY_GATEWAY_ALLOWED_TARGET_ORIGINS: "http://127.0.0.1:8080,https://gl-eye.example.test",
    });
    expect(config.allowedTargetOrigins).toHaveLength(2);
  });
});
