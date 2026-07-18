export type TargetAdapterKind = "gl-eye" | "reference-sut";

export interface TargetIntegrationConfig {
  readonly adapter: TargetAdapterKind;
  readonly gatewayAdminUrl: string;
  readonly gatewayAdminToken: string;
  readonly glEyeBaseUrl: string;
  readonly glEyeEnvironment: string;
  readonly glEyeAuthToken: string;
  readonly glEyeAllowedOrigins: readonly string[];
}

export interface MaintenanceConfig {
  readonly intervalMs: number;
  readonly batchSize: number;
  readonly claimTtlMs: number;
  readonly artifactRetentionMs: number;
  readonly adminToken?: string;
}

export type ConfiguredBrowser = "chromium" | "firefox" | "webkit";

export interface ControlPlaneConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly logLevel: string;
  readonly scenariosDirectory: string;
  readonly vendorPackagesDirectory: string;
  readonly browserPackagesDirectory: string;
  readonly generatedRunsDirectory: string;
  readonly browser: ConfiguredBrowser;
  readonly browserHeadless: boolean;
  readonly maintenance: MaintenanceConfig;
  readonly runtimeImage?: string;
  readonly runtimeNetworkName?: string;
  readonly targetIntegration?: TargetIntegrationConfig;
}

const DEFAULT_PORT = 3000;
const DEFAULT_DATABASE_URL = "postgresql://testy:testy@localhost:5432/testy";

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `CONTROL_PLANE_PORT must be an integer between 1 and 65535; received ${value}`,
    );
  }
  return port;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ControlPlaneConfig {
  const targetIntegration = loadTargetIntegration(environment);
  const runtimeImage = nonEmpty(environment.TESTY_IMPOSTER_IMAGE);
  const runtimeNetworkName = nonEmpty(environment.TESTY_DOCKER_NETWORK);
  return {
    host: environment.CONTROL_PLANE_HOST ?? "0.0.0.0",
    port: parsePort(environment.CONTROL_PLANE_PORT),
    databaseUrl: environment.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    logLevel: environment.LOG_LEVEL ?? "info",
    scenariosDirectory: environment.SCENARIOS_DIR ?? "scenarios",
    vendorPackagesDirectory: environment.VENDOR_PACKAGES_DIR ?? "vendors",
    browserPackagesDirectory: environment.BROWSER_PACKAGES_DIR ?? "customers",
    generatedRunsDirectory: environment.GENERATED_RUNS_DIR ?? "generated/runs",
    browser: parseBrowser(environment.TESTY_BROWSER),
    browserHeadless: parseBoolean(environment.TESTY_HEADLESS, true),
    maintenance: loadMaintenance(environment),
    ...(runtimeImage ? { runtimeImage } : {}),
    ...(runtimeNetworkName ? { runtimeNetworkName } : {}),
    ...(targetIntegration ? { targetIntegration } : {}),
  };
}

function loadMaintenance(environment: NodeJS.ProcessEnv): MaintenanceConfig {
  const adminToken = nonEmpty(environment.TESTY_MAINTENANCE_ADMIN_TOKEN);
  if (adminToken && adminToken.length < 16) {
    throw new Error(
      "TESTY_MAINTENANCE_ADMIN_TOKEN must contain at least 16 characters.",
    );
  }
  return {
    intervalMs: parseInteger(
      "TESTY_MAINTENANCE_INTERVAL_MS",
      environment.TESTY_MAINTENANCE_INTERVAL_MS,
      60_000,
      0,
      86_400_000,
    ),
    batchSize: parseInteger(
      "TESTY_MAINTENANCE_BATCH_SIZE",
      environment.TESTY_MAINTENANCE_BATCH_SIZE,
      100,
      1,
      10_000,
    ),
    claimTtlMs: parseInteger(
      "TESTY_MAINTENANCE_CLAIM_TTL_MS",
      environment.TESTY_MAINTENANCE_CLAIM_TTL_MS,
      300_000,
      1_000,
      86_400_000,
    ),
    artifactRetentionMs: parseInteger(
      "TESTY_ARTIFACT_RETENTION_MS",
      environment.TESTY_ARTIFACT_RETENTION_MS,
      7 * 24 * 60 * 60 * 1000,
      0,
      365 * 24 * 60 * 60 * 1000,
    ),
    ...(adminToken ? { adminToken } : {}),
  };
}

function loadTargetIntegration(
  environment: NodeJS.ProcessEnv,
): TargetIntegrationConfig | undefined {
  const values = {
    gatewayAdminUrl: nonEmpty(environment.TESTY_GATEWAY_ADMIN_URL),
    gatewayAdminToken: nonEmpty(environment.TESTY_GATEWAY_ADMIN_TOKEN),
    glEyeBaseUrl: nonEmpty(environment.GL_EYE_BASE_URL),
    glEyeEnvironment: nonEmpty(environment.GL_EYE_ENVIRONMENT),
    glEyeAuthToken: nonEmpty(environment.GL_EYE_TEST_SUPPORT_TOKEN),
    glEyeAllowedOrigins: nonEmpty(environment.GL_EYE_ALLOWED_ORIGINS),
  };
  const present = Object.values(values).filter(
    (value) => value !== undefined,
  ).length;
  if (present === 0) return undefined;
  if (present !== Object.keys(values).length) {
    throw new Error(
      "Gateway and target test-support integration must be configured completely or omitted entirely.",
    );
  }
  const allowedOrigins = splitCsv(values.glEyeAllowedOrigins ?? "");
  if (allowedOrigins.length === 0) {
    throw new Error("GL_EYE_ALLOWED_ORIGINS must contain at least one origin.");
  }
  return {
    adapter: parseTargetAdapter(environment.TESTY_TARGET_ADAPTER),
    gatewayAdminUrl: values.gatewayAdminUrl ?? "",
    gatewayAdminToken: values.gatewayAdminToken ?? "",
    glEyeBaseUrl: values.glEyeBaseUrl ?? "",
    glEyeEnvironment: values.glEyeEnvironment ?? "",
    glEyeAuthToken: values.glEyeAuthToken ?? "",
    glEyeAllowedOrigins: allowedOrigins,
  };
}

function parseTargetAdapter(value: string | undefined): TargetAdapterKind {
  const normalized = nonEmpty(value) ?? "gl-eye";
  if (normalized === "gl-eye" || normalized === "reference-sut") return normalized;
  throw new Error("TESTY_TARGET_ADAPTER must be gl-eye or reference-sut.");
}

function parseBrowser(value: string | undefined): ConfiguredBrowser {
  const normalized = nonEmpty(value) ?? "chromium";
  if (normalized === "chromium" || normalized === "firefox" || normalized === "webkit") {
    return normalized;
  }
  throw new Error("TESTY_BROWSER must be chromium, firefox, or webkit.");
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = nonEmpty(value)?.toLowerCase();
  if (normalized === undefined) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("TESTY_HEADLESS must be true or false.");
}

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function splitCsv(value: string): readonly string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
