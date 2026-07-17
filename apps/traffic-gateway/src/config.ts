export interface TrafficGatewayAppConfig {
  readonly host: string;
  readonly port: number;
  readonly adminToken: string;
  readonly allowedTargetOrigins: readonly string[];
  readonly blockedProviderHosts: readonly string[];
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
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("TESTY_GATEWAY_PORT must be an integer between 1 and 65535.");
  }
  return port;
}
