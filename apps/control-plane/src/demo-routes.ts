import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GlEyeTestSupportError } from "@testy/gl-eye-adapter";

import {
  InteractiveDemoService,
  type ApplyDemoVisitorInput,
  type CreateDemoSessionInput,
} from "./demo-service.js";

interface DemoParams {
  readonly id: string;
}
interface DemoAccountParams extends DemoParams {
  readonly accountId: string;
}

export function registerInteractiveDemoRoutes(
  app: FastifyInstance,
  demos: InteractiveDemoService,
): void {
  app.addHook("onRequest", async (request, reply) => {
    const hostname = request.hostname.toLowerCase();
    if (!demos.isDemoWebsiteHostname(hostname)) {
      return;
    }
    const localOrigin = await demos.localWebsiteOriginForHost(hostname);
    if (!localOrigin) {
      reply.status(410).send({
        error: "demo-runtime-unavailable",
        message:
          "This Interactive Demo hostname does not currently have a live Testy runtime. Refresh the Control Plane or start a new demo session.",
      });
      return reply;
    }
    await proxyDemoWebsite(request, reply, localOrigin);
    return reply;
  });

  app.get("/v1/demo-profiles", async () => ({
    profiles: await demos.profiles(),
  }));

  app.get("/v1/demo-sessions", async () => ({
    sessions: (await demos.listControllable()).map((session) => ({
      id: session.id,
      status: session.status,
      workspaceName: demos.workspaceName(session),
      credentialEmail: session.credentialEmail,
      keepWorkspace: session.keepWorkspace,
      shareSeededDemoAccounts: session.shareSeededDemoAccounts ?? true,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      hibernatedAt: session.hibernatedAt,
      expiresAt: session.expiresAt,
    })),
  }));

  app.post<{ Body: CreateDemoSessionInput }>(
    "/v1/demo-sessions",
    async (request, reply) => {
      try {
        const session = await demos.create(readCreateDemoInput(request.body));
        return reply.status(201).send(presentSession(demos, session));
      } catch (error) {
        return sendDemoError(reply, error);
      }
    },
  );

  app.get<{ Params: DemoParams }>(
    "/v1/demo-sessions/:id",
    async (request, reply) => {
      const session = await demos.get(request.params.id);
      return session
        ? presentSession(demos, session)
        : reply.status(404).send({ error: "demo-session-not-found" });
    },
  );

  app.get<{ Params: DemoParams }>(
    "/v1/demo-sessions/:id/accounts",
    async (request, reply) => {
      try {
        return await demos.demoAccounts(request.params.id);
      } catch (error) {
        return sendDemoError(reply, error);
      }
    },
  );

  app.post<{ Params: DemoParams; Body: { role?: string } }>(
    "/v1/demo-sessions/:id/accounts",
    async (request, reply) => {
      try {
        const role = (request.body as { role?: unknown } | null)?.role;
        if (role !== "admin" && role !== "sales" && role !== "read_only") {
          return reply.status(400).send({ error: "invalid-demo-role" });
        }
        return reply.status(201).send(await demos.createDemoAccount(request.params.id, role));
      } catch (error) {
        return sendDemoError(reply, error);
      }
    },
  );

  app.delete<{ Params: DemoAccountParams }>(
    "/v1/demo-sessions/:id/accounts/:accountId",
    async (request, reply) => {
      try {
        return await demos.revokeDemoAccount(request.params.id, request.params.accountId);
      } catch (error) {
        return sendDemoError(reply, error);
      }
    },
  );

  app.post<{ Params: DemoParams; Body: ApplyDemoVisitorInput }>(
    "/v1/demo-sessions/:id/visitor",
    async (request, reply) => {
      try {
        const session = await demos.applyVisitor(
          request.params.id,
          readVisitorInput(request.body),
        );
        return presentSession(demos, session);
      } catch (error) {
        return sendDemoError(reply, error);
      }
    },
  );

  app.post<{ Params: DemoParams }>(
    "/v1/demo-sessions/:id/reset-visitor",
    async (request, reply) => {
      try {
        return presentSession(
          demos,
          await demos.resetVisitor(request.params.id),
        );
      } catch (error) {
        return sendDemoError(reply, error);
      }
    },
  );

  app.get<{ Params: DemoParams }>(
    "/v1/demo-sessions/:id/activity",
    async (request, reply) => {
      try {
        return await demos.activity(request.params.id);
      } catch (error) {
        return sendDemoError(reply, error);
      }
    },
  );

  app.get<{ Params: DemoParams }>(
    "/v1/demo-sessions/:id/outcome",
    async (request, reply) => {
      try {
        return {
          sessionId: request.params.id,
          outcome: await demos.outcome(request.params.id),
        };
      } catch (error) {
        return sendDemoError(reply, error);
      }
    },
  );

  app.post<{ Params: DemoParams }>(
    "/v1/demo-sessions/:id/hibernate",
    async (request, reply) => {
      try {
        const session = await demos.hibernate(request.params.id);
        return session
          ? presentSession(demos, session)
          : reply.status(404).send({ error: "demo-session-not-found" });
      } catch (error) {
        return sendDemoError(reply, error);
      }
    },
  );

  app.post<{ Params: DemoParams }>(
    "/v1/demo-sessions/:id/resume",
    async (request, reply) => {
      try {
        const session = await demos.resume(request.params.id);
        return session
          ? presentSession(demos, session)
          : reply.status(404).send({ error: "demo-session-not-found" });
      } catch (error) {
        return sendDemoError(reply, error);
      }
    },
  );

  app.delete<{ Params: DemoParams }>(
    "/v1/demo-sessions/:id",
    async (request, reply) => {
      try {
        const session = await demos.stop(request.params.id);
        return session
          ? presentSession(demos, session)
          : reply.status(404).send({ error: "demo-session-not-found" });
      } catch (error) {
        return sendDemoError(reply, error);
      }
    },
  );
}

async function proxyDemoWebsite(
  request: FastifyRequest,
  reply: FastifyReply,
  localOrigin: string,
): Promise<void> {
  const target = new URL(request.raw.url ?? "/", localOrigin);
  const method = request.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await readRawBody(request, 128 * 1024);
  const headers = new Headers();
  for (const name of ["accept", "content-type", "user-agent"] as const) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  const response = await fetch(target, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
    redirect: "manual",
  });
  reply.status(response.status);
  for (const name of [
    "content-type",
    "cache-control",
    "content-security-policy",
    "location",
    "x-content-type-options",
  ]) {
    const value = response.headers.get(name);
    if (value) reply.header(name, value);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  reply.send(bytes);
}

async function readRawBody(
  request: FastifyRequest,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request.raw) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > limit) {
      throw new Error("Interactive Demo browser request exceeded the body limit.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function presentSession(
  demos: InteractiveDemoService,
  session: Awaited<ReturnType<InteractiveDemoService["create"]>>,
) {
  return {
    ...session,
    workspaceName: demos.workspaceName(session),
    websiteUrl:
      session.status === "READY" || session.status === "ACTIVE"
        ? demos.websiteUrl(session)
        : undefined,
  };
}

function readCreateDemoInput(value: unknown): CreateDemoSessionInput {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Demo session options must be an object.");
  }
  const record = value as Record<string, unknown>;
  const credentialMode = record.credentialMode;
  if (
    credentialMode !== undefined &&
    credentialMode !== "shared" &&
    credentialMode !== "generated"
  ) {
    throw new Error("Demo credential mode must be shared or generated.");
  }
  const share = record.shareSeededDemoAccounts;
  if (share !== undefined && typeof share !== "boolean") {
    throw new Error("shareSeededDemoAccounts must be a boolean.");
  }
  const keepWorkspace = record.keepWorkspace;
  if (keepWorkspace !== undefined && typeof keepWorkspace !== "boolean") {
    throw new Error("keepWorkspace must be a boolean.");
  }
  return {
    ...(credentialMode ? { credentialMode } : {}),
    ...(typeof share === "boolean" ? { shareSeededDemoAccounts: share } : {}),
    ...(typeof keepWorkspace === "boolean" ? { keepWorkspace } : {}),
  };
}

function readVisitorInput(value: unknown): ApplyDemoVisitorInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Visitor selection must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.networkId !== "string" ||
    typeof record.browserId !== "string" ||
    (record.personId !== undefined && typeof record.personId !== "string")
  ) {
    throw new Error("Visitor selection is incomplete.");
  }
  return {
    networkId: record.networkId,
    browserId: record.browserId,
    ...(record.personId ? { personId: record.personId } : {}),
  };
}

function sendDemoError(reply: FastifyReply, error: unknown) {
  if (error instanceof GlEyeTestSupportError
    && [409, 422].includes(error.targetStatus)) {
    return reply.status(error.targetStatus).send({
      error: error.targetStatus === 422 ? "demo-target-validation-failed" : "demo-target-conflict",
      message: error.message,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("not found")) {
    return reply.status(404).send({ error: "demo-session-not-found" });
  }
  if (
    message.includes("Unknown ") ||
    message.includes("does not belong") ||
    message.includes("cannot select") ||
    message.includes("must be an object") ||
    message.includes("credential mode") ||
    message.includes("shareSeededDemoAccounts must") ||
    message.includes("keepWorkspace must") ||
    message.includes("incomplete")
  ) {
    return reply.status(400).send({
      error: "demo-visitor-invalid",
      message,
    });
  }
  if (
    message.includes("not active") ||
    message.includes("no manageable workspace") ||
    message.includes("cannot hibernate") ||
    message.includes("cannot resume") ||
    message.includes("no workspace") ||
    message.includes("runtime is unavailable")
  ) {
    return reply.status(409).send({
      error: "demo-session-not-active",
      message,
    });
  }
  throw error;
}
