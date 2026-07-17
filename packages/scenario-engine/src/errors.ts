import type { SanitizedError } from "@testy/shared-types";

export class ScenarioValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(issues.join("\n"));
    this.name = "ScenarioValidationError";
    this.issues = issues;
  }
}

export class ScenarioCancelledError extends Error {
  public constructor(message = "Scenario execution cancelled.") {
    super(message);
    this.name = "ScenarioCancelledError";
  }
}

export class ScenarioTimeoutError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ScenarioTimeoutError";
  }
}

export function sanitizeScenarioError(error: unknown): SanitizedError {
  if (error instanceof ScenarioCancelledError) {
    return { name: error.name, message: "Scenario execution cancelled.", code: "cancelled" };
  }
  if (error instanceof ScenarioTimeoutError) {
    return { name: error.name, message: error.message, code: "timeout" };
  }
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: redact(error.message),
    };
  }
  return { name: "Error", message: "Unknown scenario execution error." };
}

function redact(value: string): string {
  return value
    .replace(/(?:bearer\s+|api[_-]?key[=:]\s*|password[=:]\s*)[^\s,;]+/giu, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
    .slice(0, 500);
}
