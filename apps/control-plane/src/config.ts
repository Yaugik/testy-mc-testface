export interface TargetIntegrationConfig {
  readonly gatewayAdminUrl: string;
  readonly gatewayAdminToken: string;
  readonly glEyeBaseUrl: string;
  readonly glEyeEnvironment: string;
  readonly glEyeAuthToken: string;
  readonly glEyeAllowedOrigins: readonly string[];
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
  readonly runtimeImage?: string;
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
    ...(runtimeImage ? { runtimeImage } : {}),
    ...(targetIntegration ? { targetIntegration } : {}),
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
      "Gateway and GL-EYE integration must be configured completely or omitted entirely.",
    );
  }
  const allowedOrigins = splitCsv(values.glEyeAllowedOrigins ?? "");
  if (allowedOrigins.length === 0) {
    throw new Error("GL_EYE_ALLOWED_ORIGINS must contain at least one origin.");
  }
  return {
    gatewayAdminUrl: values.gatewayAdminUrl ?? "",
    gatewayAdminToken: values.gatewayAdminToken ?? "",
    glEyeBaseUrl: values.glEyeBaseUrl ?? "",
    glEyeEnvironment: values.glEyeEnvironment ?? "",
    glEyeAuthToken: values.glEyeAuthToken ?? "",
    glEyeAllowedOrigins: allowedOrigins,
  };
}

function parseBrowser(value: string | undefined): ConfiguredBrowser {
  const normalized = nonEmpty(value) ?? "chromium";
  if (
    normalized === "chromium" ||
    normalized === "firefox" ||
    normalized === "webkit"
  ) {
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

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function splitCsv(value: string): readonly string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
