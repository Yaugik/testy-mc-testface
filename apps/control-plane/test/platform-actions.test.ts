import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { createPlatformActions } from "../src/platform-actions.js";

describe("platform target integration", () => {
  it("keeps target and traffic actions disabled while retaining vendor and browser actions", () => {
    const platform = createPlatformActions(loadConfig({}), {} as never);
    expect(platform.actions["target.prepare-run"]).toBeUndefined();
    expect(platform.actions["traffic.send"]).toBeUndefined();
    expect(platform.actions["vendor.compile"]).toBeDefined();
    expect(platform.actions["browser.run-journey"]).toBeDefined();
    expect(platform.actions.noop).toBeDefined();
  });

  it("registers gateway-bound traffic actions with complete test integration", () => {
    const platform = createPlatformActions(
      loadConfig({
        TESTY_GATEWAY_ADMIN_URL: "http://127.0.0.1:3100",
        TESTY_GATEWAY_ADMIN_TOKEN: "synthetic-gateway-admin-token",
        GL_EYE_BASE_URL: "http://127.0.0.1:8080",
        GL_EYE_ENVIRONMENT: "local",
        GL_EYE_TEST_SUPPORT_TOKEN: "synthetic-test-support-token",
        GL_EYE_ALLOWED_ORIGINS: "http://127.0.0.1:8080",
      }),
      {} as never,
    );

    expect(platform.actions["traffic.send"]).toBeDefined();
    expect(platform.actions["traffic.repeat"]).toBeDefined();
    expect(platform.actions["traffic.burst"]).toBeDefined();
  });

  it("treats empty integration environment values as absent", () => {
    const config = loadConfig({
      TESTY_GATEWAY_ADMIN_URL: "",
      TESTY_GATEWAY_ADMIN_TOKEN: "   ",
      GL_EYE_BASE_URL: "",
      GL_EYE_ENVIRONMENT: "",
      GL_EYE_TEST_SUPPORT_TOKEN: "",
      GL_EYE_ALLOWED_ORIGINS: "",
    });
    expect(config.targetIntegration).toBeUndefined();
  });

  it("rejects a non-empty partial integration mixed with empty values", () => {
    expect(() =>
      loadConfig({
        TESTY_GATEWAY_ADMIN_URL: "http://127.0.0.1:3100",
        TESTY_GATEWAY_ADMIN_TOKEN: "",
        GL_EYE_BASE_URL: "",
        GL_EYE_ENVIRONMENT: "",
        GL_EYE_TEST_SUPPORT_TOKEN: "",
        GL_EYE_ALLOWED_ORIGINS: "",
      }),
    ).toThrow(/completely/u);
  });

  it("rejects partial target configuration", () => {
    expect(() =>
      loadConfig({ TESTY_GATEWAY_ADMIN_URL: "http://127.0.0.1:3100" }),
    ).toThrow(/completely/u);
  });
});
