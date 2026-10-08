import Fastify from "fastify";
import type { RunId } from "@testy/shared-types";
import { describe, expect, it } from "vitest";

import type { DemoSessionRecord } from "../src/demo-repository.js";
import { registerInteractiveDemoRoutes } from "../src/demo-routes.js";
import type { InteractiveDemoService } from "../src/demo-service.js";

describe("shared Interactive Demo routes", () => {
  it("lists sessions without passwords and lets other clients join, hibernate, resume and delete", async () => {
    const session: DemoSessionRecord = {
      id: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222" as RunId,
      status: "READY",
      customerPackage: "customer-alpha",
      websiteHostname: "demo-11111111.localhost",
      credentialMode: "generated",
      credentialEmail: "demo-test@example.com",
      credentialPassword: "Demo-PrivatePassword9!Aa",
      keepWorkspace: true,
      resetVersion: 0,
      startedAt: "2026-10-08T00:00:00.000Z",
      expiresAt: "2026-10-09T00:00:00.000Z",
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z",
    };
    const actions: string[] = [];
    const demos = {
      isDemoWebsiteHostname: () => false,
      workspaceName: () => "Testy Demo - 11111111",
      websiteUrl: () => "http://demo-11111111.localhost:23000",
      listControllable: async () => [session],
      get: async () => session,
      hibernate: async () => {
        actions.push("hibernate");
        return { ...session, status: "HIBERNATED" };
      },
      resume: async () => {
        actions.push("resume");
        return { ...session, status: "READY" };
      },
      stop: async () => {
        actions.push("delete");
        return {
          ...session,
          status: "STOPPED",
          credentialPassword: undefined,
        };
      },
    } as unknown as InteractiveDemoService;
    const app = Fastify();
    registerInteractiveDemoRoutes(app, demos);
    try {
      const list = await app.inject({ method: "GET", url: "/v1/demo-sessions" });
      expect(list.statusCode).toBe(200);
      expect(list.json().sessions).toHaveLength(1);
      expect(list.json().sessions[0].workspaceName).toBe("Testy Demo - 11111111");
      expect(list.body).not.toContain("Demo-PrivatePassword9!Aa");

      const get = await app.inject({
        method: "GET",
        url: `/v1/demo-sessions/${session.id}`,
      });
      expect(get.statusCode).toBe(200);
      expect(get.json().credentialPassword).toBe("Demo-PrivatePassword9!Aa");

      const hibernate = await app.inject({
        method: "POST",
        url: `/v1/demo-sessions/${session.id}/hibernate`,
      });
      expect(hibernate.json().status).toBe("HIBERNATED");

      const resume = await app.inject({
        method: "POST",
        url: `/v1/demo-sessions/${session.id}/resume`,
      });
      expect(resume.json().status).toBe("READY");

      const deleted = await app.inject({
        method: "DELETE",
        url: `/v1/demo-sessions/${session.id}`,
      });
      expect(deleted.json().status).toBe("STOPPED");
      expect(deleted.body).not.toContain("Demo-PrivatePassword9!Aa");
      expect(actions).toEqual(["hibernate", "resume", "delete"]);
    } finally {
      await app.close();
    }
  });
});
