import { ScenarioCancelledError } from "./errors.js";
import type { ScenarioActionRegistry, ScenarioValue } from "./types.js";

export function createBuiltinScenarioActions(): ScenarioActionRegistry {
  return {
    noop: async (input) => input,
    value: async (input) => input,
    delay: async (input, context) => {
      const milliseconds = readNumber(input, "ms");
      await delay(milliseconds, context.signal);
      return input;
    },
    fail: async () => {
      throw new Error("Configured scenario action failed.");
    },
    "register-cleanup": async (input, context) => {
      const name = readString(input, "name");
      context.registerCleanup(name, async () => undefined);
      return { registered: name };
    },
    lease: async (input, context) => {
      const resourceType = readString(input, "resourceType");
      const resourceKey = readString(input, "resourceKey");
      const ttlMs = readNumber(input, "ttlMs");
      const lease = await context.registerResourceLease(
        resourceType,
        resourceKey,
        new Date(Date.now() + Math.max(ttlMs, 1)).toISOString(),
        async () => undefined,
      );
      return { leaseId: lease.leaseId };
    },
  };
}

function readNumber(input: ScenarioValue | undefined, key: string): number {
  if (!input || typeof input !== "object" || Array.isArray(input)) return 0;
  const value = (input as Readonly<Record<string, ScenarioValue>>)[key];
  return typeof value === "number" ? value : 0;
}

function readString(input: ScenarioValue | undefined, key: string): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return key;
  const value = (input as Readonly<Record<string, ScenarioValue>>)[key];
  return typeof value === "string" ? value : key;
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new ScenarioCancelledError();
  await new Promise<void>((resolveDelay, rejectDelay) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolveDelay();
    }, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      rejectDelay(new ScenarioCancelledError());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
