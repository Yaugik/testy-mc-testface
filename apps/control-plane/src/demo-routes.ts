import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  InteractiveDemoService,
  type ApplyDemoVisitorInput,
} from "./demo-service.js";

interface DemoParams {
  readonly id: string;
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

  app.post("/v1/demo-sessions", async (_request, reply) => {
    const session = await demos.create();
    return reply.status(201).send(presentSession(demos, session));
  });

  app.get<{ Params: DemoParams }>(
    "/v1/demo-sessions/:id",
    async (request, reply) => {
      const session = await demos.get(request.params.id);
      return session
        ? presentSession(demos, session)
        : reply.status(404).send({ error: "demo-session-not-found" });
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

  app.delete<{ Params: DemoParams }>(
    "/v1/demo-sessions/:id",
    async (request, reply) => {
      const session = await demos.stop(request.params.id);
      return session
        ? presentSession(demos, session)
        : reply.status(404).send({ error: "demo-session-not-found" });
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
    websiteUrl:
      session.status === "READY" || session.status === "ACTIVE"
        ? demos.websiteUrl(session)
        : undefined,
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
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("not found")) {
    return reply.status(404).send({ error: "demo-session-not-found" });
  }
  if (
    message.includes("Unknown ") ||
    message.includes("does not belong") ||
    message.includes("cannot select") ||
    message.includes("must be an object") ||
    message.includes("incomplete")
  ) {
    return reply.status(400).send({
      error: "demo-visitor-invalid",
      message,
    });
  }
  if (
    message.includes("not active") ||
    message.includes("runtime is unavailable")
  ) {
    return reply.status(409).send({
      error: "demo-session-not-active",
      message,
    });
  }
  throw error;
}
