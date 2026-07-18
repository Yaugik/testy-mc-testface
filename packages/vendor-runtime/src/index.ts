import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const IMPOSTER_IMAGE = "outofcoffee/imposter:4.9.2" as const;

export interface ProviderCallInput {
  readonly runId: string;
  readonly provider: string;
  readonly operation: string;
  readonly matchedCase: string;
  readonly attempt: number;
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string | undefined>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
  readonly status: number;
  readonly durationMs: number;
  readonly stateBefore?: string;
  readonly stateAfter?: string;
  readonly correlationId?: string;
}

export interface ProviderCallRecord {
  readonly runId: string;
  readonly provider: string;
  readonly operation: string;
  readonly matchedCase: string;
  readonly attempt: number;
  readonly requestFingerprint: string;
  readonly responseStatus: number;
  readonly durationMs: number;
  readonly stateBefore?: string;
  readonly stateAfter?: string;
  readonly correlationId?: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/authorization|cookie|token|secret|email|phone/i.test(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  if (typeof value === "string") {
    return value
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (ip) => {
        const octets = ip.split(".");
        return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
      })
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
  }
  return value;
}

export function sanitizeProviderCall(input: ProviderCallInput): ProviderCallRecord {
  const safeRequest = canonicalize({
    method: input.method.toUpperCase(),
    path: input.path,
    query: input.query,
    headers: input.headers,
    body: input.body,
  });
  const requestFingerprint = createHash("sha256")
    .update(JSON.stringify(safeRequest))
    .digest("hex");

  return {
    runId: input.runId,
    provider: input.provider,
    operation: input.operation,
    matchedCase: input.matchedCase,
    attempt: input.attempt,
    requestFingerprint,
    responseStatus: input.status,
    durationMs: input.durationMs,
    ...(input.stateBefore === undefined ? {} : { stateBefore: input.stateBefore }),
    ...(input.stateAfter === undefined ? {} : { stateAfter: input.stateAfter }),
    ...(input.correlationId === undefined
      ? {}
      : { correlationId: input.correlationId }),
  };
}

export interface StartedRuntime {
  readonly containerName: string;
  readonly baseUrl: string;
  readonly image: string;
}

export class ImposterRuntimeManager {
  public constructor(private readonly image: string = IMPOSTER_IMAGE) {}

  public async start(runId: string, configDirectory: string): Promise<StartedRuntime> {
    const safeRunId = runId.replace(/[^a-zA-Z0-9_.-]/g, "-");
    const containerName = `testy-imposter-${safeRunId}`;
    await this.forceCleanup(containerName);

    await execFileAsync("docker", [
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--publish",
      "127.0.0.1::8080",
      "--volume",
      `${resolve(configDirectory)}:/opt/imposter/config:ro`,
      this.image,
      "--listenPort",
      "8080",
    ]);

    const { stdout } = await execFileAsync("docker", [
      "port",
      containerName,
      "8080/tcp",
    ]);
    const port = stdout.trim().split(":").at(-1);
    if (port === undefined || !/^\d+$/.test(port)) {
      await this.forceCleanup(containerName);
      throw new Error(`Could not determine published port for ${containerName}`);
    }

    const runtime = {
      containerName,
      baseUrl: `http://127.0.0.1:${port}`,
      image: this.image,
    };

    try {
      await this.waitForReadiness(runtime.baseUrl);
      return runtime;
    } catch (error) {
      await this.forceCleanup(containerName);
      throw error;
    }
  }

  public async stop(runtime: StartedRuntime): Promise<void> {
    await this.forceCleanup(runtime.containerName);
  }

  private async waitForReadiness(baseUrl: string): Promise<void> {
    const deadline = Date.now() + 20_000;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${baseUrl}/system/status`);
        if (response.ok) {
          return;
        }
        lastError = new Error(`Readiness returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }

    throw new Error(
      `Imposter did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  private async forceCleanup(containerName: string): Promise<void> {
    try {
      await execFileAsync("docker", ["rm", "--force", containerName]);
    } catch {
      // Cleanup is intentionally idempotent.
    }
  }
}

export async function runImposterCapabilitySpike(
  configDirectory: string,
): Promise<{ readonly status: number; readonly body: unknown; readonly ledger: ProviderCallRecord }> {
  const manager = new ImposterRuntimeManager();
  const runtime = await manager.start(`spike-${Date.now()}`, configDirectory);
  const startedAt = performance.now();

  try {
    const response = await fetch(`${runtime.baseUrl}/ipinfo/203.0.113.10`, {
      headers: {
        authorization: "Bearer synthetic-test-token",
        "x-testy-run-id": "spike",
      },
    });
    const body = (await response.json()) as unknown;
    const ledger = sanitizeProviderCall({
      runId: "spike",
      provider: "ipinfo",
      operation: "lookup",
      matchedCase: "corporate-ip",
      attempt: 1,
      method: "GET",
      path: "/ipinfo/203.0.113.10",
      query: {},
      headers: {
        authorization: "Bearer synthetic-test-token",
        "x-testy-run-id": "spike",
      },
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return { status: response.status, body, ledger };
  } finally {
    await manager.stop(runtime);
  }
}
