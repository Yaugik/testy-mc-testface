import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
  ScenarioActionContext,
  ScenarioValue,
} from "@testy/scenario-engine";
import type {
  ProviderCallLedgerEntry,
  RunningVendorRuntime,
} from "@testy/vendor-runtime";

import type { RunState, VendorState } from "./state.js";

export function requireVendor(state: RunState, vendorId: string): VendorState {
  const vendor = state.vendors.get(vendorId);
  if (!vendor) {
    throw new Error(`Vendor '${vendorId}' has not been compiled for this run.`);
  }
  return vendor;
}

export function requireRuntime(
  vendor: VendorState,
  vendorId: string,
): RunningVendorRuntime {
  if (!vendor.runtime) {
    throw new Error(`Vendor runtime '${vendorId}' has not been started.`);
  }
  return vendor.runtime;
}

export function requireBrowserPackage(state: RunState) {
  if (!state.browserPackage)
    throw new Error("Browser package has not been loaded.");
  return state.browserPackage;
}

export function requireSite(state: RunState) {
  if (!state.site) throw new Error("Synthetic site has not been started.");
  return state.site;
}

export function readObject(
  value: ScenarioValue | undefined,
): Readonly<Record<string, ScenarioValue>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Scenario action input must be an object.");
  }
  return value as Readonly<Record<string, ScenarioValue>>;
}

export function readString(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): string {
  const selected = value[key];
  if (typeof selected !== "string" || selected.length === 0) {
    throw new Error(
      `Scenario action input '${key}' must be a non-empty string.`,
    );
  }
  return selected;
}

export function readSafeRelativeName(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): string {
  const selected = readString(value, key);
  if (
    isAbsolute(selected) ||
    selected === "." ||
    selected === ".." ||
    selected.includes("\\")
  ) {
    throw new Error(
      `Scenario action input '${key}' must be a safe relative package name.`,
    );
  }
  const segments = selected.split("/");
  if (segments.some((segment) => !/^[a-z0-9][a-z0-9._-]*$/iu.test(segment))) {
    throw new Error(
      `Scenario action input '${key}' contains an unsafe path segment.`,
    );
  }
  return selected;
}

export function safeChild(root: string, child: string): string {
  const resolvedRoot = resolve(root);
  const destination = resolve(resolvedRoot, child);
  const relativePath = relative(resolvedRoot, destination);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Package path '${child}' escapes its configured root.`);
  }
  return destination;
}

export function safeSegment(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return (result || "run").slice(0, 80);
}

export function ledgerKey(entry: ProviderCallLedgerEntry): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        entry.vendorId,
        entry.operationId ?? null,
        entry.caseId ?? null,
        entry.correlationId ?? null,
        entry.timestamp ?? null,
        entry.sequenceIndex ?? null,
        entry.statusCode ?? null,
      ]),
    )
    .digest("hex");
}

export function sanitizeUnknown(value: unknown): ScenarioValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitizeUnknown);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          sensitiveKey(key) ? "[redacted]" : sanitizeUnknown(item),
        ]),
    );
  }
  return String(value);
}

export function runKey(context: ScenarioActionContext): string {
  return context.runId as string;
}

function sensitiveKey(key: string): boolean {
  return /authorization|cookie|password|secret|token|api[-_]?key|email|body/iu.test(
    key,
  );
}
