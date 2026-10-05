export interface TrafficGatewayAppConfig {
  readonly host: string;
  readonly port: number;
  readonly adminToken: string;
  readonly allowedTargetOrigins: readonly string[];
  readonly blockedProviderHosts: readonly string[];
  readonly maxRouteTtlMs: number;
}

export function loadTrafficGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env,
): TrafficGatewayAppConfig {
  const adminToken = requireValue(environment.TESTY_GATEWAY_ADMIN_TOKEN, "TESTY_GATEWAY_ADMIN_TOKEN");
  const allowedTargetOrigins = splitCsv(
    requireValue(environment.TESTY_GATEWAY_ALLOWED_TARGET_ORIGINS, "TESTY_GATEWAY_ALLOWED_TARGET_ORIGINS"),
  );
  if (allowedTargetOrigins.length === 0) {
    throw new Error("TESTY_GATEWAY_ALLOWED_TARGET_ORIGINS must contain at least one origin.");
  }
  return {
    host: environment.TESTY_GATEWAY_HOST ?? "127.0.0.1",
    port: parsePort(environment.TESTY_GATEWAY_PORT ?? "3100"),
    adminToken,
    allowedTargetOrigins,
    blockedProviderHosts: splitCsv(environment.TESTY_GATEWAY_BLOCKED_PROVIDER_HOSTS ?? ""),
    maxRouteTtlMs: parseInteger(
      environment.TESTY_GATEWAY_MAX_ROUTE_TTL_MS ?? "86400000",
      "TESTY_GATEWAY_MAX_ROUTE_TTL_MS",
      60_000,
      24 * 60 * 60 * 1000,
    ),
  };
}

function requireValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function splitCsv(value: string): readonly string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parsePort(value: string): number {
  return parseInteger(value, "TESTY_GATEWAY_PORT", 1, 65_535);
}

function parseInteger(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
