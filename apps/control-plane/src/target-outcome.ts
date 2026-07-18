import type { ScenarioValue } from "@testy/scenario-engine";

export function deriveTargetOutcome(
  value: ScenarioValue | undefined,
  outputs: Readonly<Record<string, ScenarioValue>>,
): ScenarioValue {
  const outcome = readRecord(value, "Target outcome");
  const prepared = findPreparedTarget(outputs);
  const tenantId = readString(outcome, "tenantId");
  const visibleTenantIds = readStringArray(outcome, "visibleTenantIds");
  const controlTenantId = prepared
    ? readOptionalString(prepared, "controlTenantId")
    : undefined;
  return {
    ...outcome,
    primaryTenantVisible: visibleTenantIds.includes(tenantId),
    controlTenantConfigured: controlTenantId !== undefined,
    controlTenantVisible: controlTenantId
      ? visibleTenantIds.includes(controlTenantId)
      : false,
  };
}

function findPreparedTarget(
  outputs: Readonly<Record<string, ScenarioValue>>,
): Readonly<Record<string, ScenarioValue>> | undefined {
  const preferred = outputs["prepare-target"];
  const candidates = preferred === undefined
    ? Object.values(outputs)
    : [preferred, ...Object.values(outputs)];
  return candidates
    .map((value) => readOptionalRecord(value))
    .find((value) =>
      value !== undefined &&
      typeof value.targetRunId === "string" &&
      typeof value.tenantId === "string" &&
      typeof value.trackingScriptUrl === "string",
    );
}

function readRecord(
  value: ScenarioValue | undefined,
  label: string,
): Readonly<Record<string, ScenarioValue>> {
  const record = readOptionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function readOptionalRecord(
  value: ScenarioValue | undefined,
): Readonly<Record<string, ScenarioValue>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, ScenarioValue>>
    : undefined;
}

function readString(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): string {
  const selected = value[key];
  if (typeof selected !== "string" || selected.length === 0) {
    throw new Error(`Target outcome '${key}' must be a non-empty string.`);
  }
  return selected;
}

function readOptionalString(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): string | undefined {
  const selected = value[key];
  return typeof selected === "string" && selected.length > 0
    ? selected
    : undefined;
}

function readStringArray(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): readonly string[] {
  const selected = value[key];
  if (!Array.isArray(selected) || selected.some((item) => typeof item !== "string")) {
    throw new Error(`Target outcome '${key}' must be an array of strings.`);
  }
  return selected as readonly string[];
}
