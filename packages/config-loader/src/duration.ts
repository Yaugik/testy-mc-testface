import type { DurationString } from "@testy/vendor-schema";

const DURATION_PATTERN = /^(?<value>\d+)(?<unit>ms|s|m)$/u;

export function parseDuration(value: DurationString): number {
  const match = DURATION_PATTERN.exec(value);

  if (!match?.groups) {
    throw new Error(`Unsupported duration: ${value}`);
  }

  const amount = Number.parseInt(match.groups.value ?? "", 10);
  const unit = match.groups.unit;

  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1_000;
    case "m":
      return amount * 60_000;
    default:
      throw new Error(`Unsupported duration unit: ${String(unit)}`);
  }
}
