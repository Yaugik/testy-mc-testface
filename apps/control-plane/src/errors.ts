import type { SanitizedError } from "@testy/shared-types";

const MAX_ERROR_MESSAGE_LENGTH = 500;

const REDACTION_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(authorization|cookie|set-cookie|password|passwd|token|api[_-]?key|secret)\s*[:=]\s*[^,;\s]+/gi, "$1=[REDACTED]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
  [/\/\/[^:/\s]+:[^@\s]+@/g, "//[REDACTED]@"],
];

export function redactText(value: string): string {
  return REDACTION_RULES.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    value,
  );
}

export function sanitizeError(error: unknown): SanitizedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactText(error.message).slice(0, MAX_ERROR_MESSAGE_LENGTH),
    };
  }

  return {
    name: "UnknownError",
    message: "An unknown error occurred.",
  };
}
