#!/usr/bin/env node
import { resolve } from "node:path";

import { loadScenarioConfig, resolveScenario } from "@testy/scenario-engine";

import { controlPlaneUrl, parseCommand } from "./index.js";

const command = parseCommand(process.argv.slice(2));
const baseUrl = process.env.TESTY_CONTROL_PLANE_URL ?? "http://127.0.0.1:3000";
let result: unknown;

switch (command.name) {
  case "validate-scenario": {
    const scenario = resolveScenario(await loadScenarioConfig(resolve(command.path)));
    result = {
      valid: true,
      scenarioId: scenario.scenarioId,
      target: scenario.target,
      contentHash: scenario.contentHash,
      resolvedScenario: scenario,
    };
    break;
  }
  case "run":
    result = await requestJson(baseUrl, "/v1/runs", {
      method: "POST",
      body: { scenarioId: command.scenarioId },
    });
    break;
  case "status":
    result = await requestJson(baseUrl, `/v1/runs/${encodeURIComponent(command.runId)}`);
    break;
  case "cancel":
    result = await requestJson(
      baseUrl,
      `/v1/runs/${encodeURIComponent(command.runId)}/cancel`,
      { method: "POST" },
    );
    break;
  case "timeline":
  case "report":
  case "artifacts":
    result = await requestJson(
      baseUrl,
      `/v1/runs/${encodeURIComponent(command.runId)}/${command.name}`,
    );
    break;
  case "doctor": {
    const [health, readiness] = await Promise.all([
      requestJson(baseUrl, "/v1/health"),
      requestJson(baseUrl, "/v1/readiness"),
    ]);
    result = { health, readiness };
    break;
  }
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

async function requestJson(
  base: string,
  path: string,
  options: {
    readonly method?: "GET" | "POST";
    readonly body?: unknown;
  } = {},
): Promise<unknown> {
  const init: RequestInit = { method: options.method ?? "GET" };
  if (options.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(controlPlaneUrl(base, path), init);
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`Control Plane request failed with HTTP ${response.status}: ${safeError(body)}`);
  }
  return body;
}

function safeError(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "request-failed";
  const error = (value as Readonly<Record<string, unknown>>).error;
  return typeof error === "string" ? error.slice(0, 100) : "request-failed";
}
