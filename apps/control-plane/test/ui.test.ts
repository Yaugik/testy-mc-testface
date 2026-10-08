import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("control panel user experience", () => {
  it("serves both workflows with searchable scenarios and sessions", async () => {
    const app = buildApp({
      database: { check: vi.fn().mockResolvedValue(undefined) },
    });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain('id="automatedMode"');
    expect(response.body).toContain('id="interactiveMode"');
    expect(response.body).toContain('id="scenarioSearch"');
    expect(response.body).toContain('id="demoSessionSearch"');
    expect(response.body).toContain('id="refreshRun"');
    expect(response.body).toContain('id="refreshDemoActivity"');
  });

  it("requires deliberate confirmation before deleting a demo workspace", async () => {
    const app = buildApp({
      database: { check: vi.fn().mockResolvedValue(undefined) },
    });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.body).toContain('id="deleteDemoDialog"');
    expect(response.body).toContain('id="deleteDemoConfirmation"');
    expect(response.body).toContain('id="confirmDeleteDemo"');
    expect(response.body).toContain('event.target.value !== "DELETE"');
    expect(response.body).toContain("confirmInteractiveDemoDeletion");
  });

  it("provides credential protection, feedback and accessible errors", async () => {
    const app = buildApp({
      database: { check: vi.fn().mockResolvedValue(undefined) },
    });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.body).toContain('id="toggleDemoPassword"');
    expect(response.body).toContain('id="copyDemoPassword"');
    expect(response.body).toContain('id="copyDemoEmail"');
    expect(response.body).toContain('id="toast"');
    expect(response.body).toContain('role="alert"');
    expect(response.body).toContain("clearDemoResults");
  });
});
