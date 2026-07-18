import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { createPlatformActions } from "../src/platform-actions.js";

describe("platform target integration", () => {
  it("keeps target actions disabled when integration is absent", () => {
    const platform = createPlatformActions(undefined);
    expect(platform.actions["target.prepare-run"]).toBeUndefined();
    expect(platform.actions.noop).toBeDefined();
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
    expect(() => loadConfig({
      TESTY_GATEWAY_ADMIN_URL: "http://127.0.0.1:3100",
      TESTY_GATEWAY_ADMIN_TOKEN: "",
      GL_EYE_BASE_URL: "",
      GL_EYE_ENVIRONMENT: "",
      GL_EYE_TEST_SUPPORT_TOKEN: "",
      GL_EYE_ALLOWED_ORIGINS: "",
    })).toThrow(/completely/u);
  });

  it("rejects partial target configuration", () => {
    expect(() => loadConfig({ TESTY_GATEWAY_ADMIN_URL: "http://127.0.0.1:3100" }))
      .toThrow(/completely/u);
  });
});
