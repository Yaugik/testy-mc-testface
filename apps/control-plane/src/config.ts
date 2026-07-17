export interface ControlPlaneConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly logLevel: string;
  readonly scenariosDirectory: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_DATABASE_URL = "postgresql://testy:testy@localhost:5432/testy";

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

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
  return {
    host: environment.CONTROL_PLANE_HOST ?? "0.0.0.0",
    port: parsePort(environment.CONTROL_PLANE_PORT),
    databaseUrl: environment.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    logLevel: environment.LOG_LEVEL ?? "info",
    scenariosDirectory: environment.SCENARIOS_DIR ?? "scenarios",
  };
}
