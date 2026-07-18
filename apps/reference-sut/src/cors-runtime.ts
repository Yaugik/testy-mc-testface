import type { IncomingMessage, ServerResponse } from "node:http";

import {
  startReferenceSut as startBaseReferenceSut,
  type ReferenceSutBinding,
  type ReferenceSutMutations,
  type ReferenceSutOptions,
} from "./runtime.js";

export type { ReferenceSutBinding, ReferenceSutMutations, ReferenceSutOptions };

export async function startReferenceSut(
  options: ReferenceSutOptions,
): Promise<ReferenceSutBinding> {
  const binding = await startBaseReferenceSut(options);
  const delegates = binding.server.listeners("request").slice();
  binding.server.removeAllListeners("request");
  binding.server.on("request", (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", binding.origin);
    if (url.pathname.startsWith("/test-support/v1/traffic/")) {
      response.setHeader("access-control-allow-origin", "*");
      response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      response.setHeader(
        "access-control-allow-headers",
        "content-type,idempotency-key,x-reference-target-run-id",
      );
      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        return;
      }
    }
    const tracking = /^\/test-support\/v1\/runs\/([^/]+)\/tracking\.js$/u.exec(
      url.pathname,
    );
    if (request.method === "GET" && tracking) {
      const targetRunId = decodeURIComponent(tracking[1] ?? "");
      const ingestionUrl = `${binding.origin}/test-support/v1/traffic/idempotent?targetRunId=${encodeURIComponent(targetRunId)}`;
      const eventId = `tracking-${targetRunId}`;
      response.statusCode = 200;
      response.setHeader("content-type", "application/javascript; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.end(
        `fetch(${JSON.stringify(ingestionUrl)},{method:"POST",headers:{"content-type":"text/plain"},body:JSON.stringify({eventId:${JSON.stringify(eventId)}})});`,
      );
      return;
    }
    for (const delegate of delegates) {
      delegate.call(binding.server, request, response);
    }
  });
  return binding;
}
