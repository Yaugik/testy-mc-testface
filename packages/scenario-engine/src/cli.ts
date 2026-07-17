#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type { RunId } from "@testy/shared-types";

import { createBuiltinScenarioActions } from "./builtins.js";
import { executeScenario } from "./executor.js";
import { loadScenarioConfig } from "./loader.js";
import { resolveScenario } from "./resolver.js";

const [command = "validate", path = "scenarios/orchestration-smoke.yaml"] =
  process.argv.slice(2);
const config = await loadScenarioConfig(resolve(path));
const scenario = resolveScenario(config);

if (command === "validate") {
  process.stdout.write(`${JSON.stringify(scenario, null, 2)}\n`);
} else if (command === "run") {
  const report = await executeScenario(scenario, createBuiltinScenarioActions(), {
    runId: randomUUID() as RunId,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "PASSED") process.exitCode = 1;
} else {
  throw new Error(`Unknown scenario command '${command}'.`);
}
