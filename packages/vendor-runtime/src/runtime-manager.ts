import { resolve } from "node:path";

import {
  IMPOSTER_CONFIG_DIRECTORY,
  IMPOSTER_CONTAINER_PORT,
  IMPOSTER_STATUS_PATH,
  TESTY_CORRELATION_HEADER,
  type WrittenVendorBundle,
} from "@testy/vendor-compiler";

import { RuntimeStartError } from "./errors.js";
import { parseProviderCallLedger } from "./ledger.js";
import { sanitizeRuntimeLogs } from "./redaction.js";
import type {
  ContainerEngine,
  ImposterStatus,
  RunningVendorRuntime,
  RuntimeStartOptions,
} from "./types.js";

export class ImposterRuntimeManager {
  public constructor(
    private readonly engine: ContainerEngine,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async start(
    bundle: WrittenVendorBundle,
    options: RuntimeStartOptions = {},
  ): Promise<RunningVendorRuntime> {
    const containerName =
      options.containerName ?? makeContainerName(bundle.manifest.vendor.id, bundle.bundleId);
    let containerId: string | undefined;

    try {
      const handle = await this.engine.run({
        image: bundle.manifest.runtime.image,
        name: containerName,
        environment: {
          IMPOSTER_LOG_LEVEL: "INFO",
          IMPOSTER_LOG_SUMMARY: "true",
          IMPOSTER_LOG_REQUEST_BODY: "false",
          IMPOSTER_LOG_RESPONSE_BODY: "false",
          IMPOSTER_LOG_REQUEST_HEADERS: TESTY_CORRELATION_HEADER,
        },
        labels: {
          "testy.bundle-id": bundle.bundleId,
          "testy.vendor-id": bundle.manifest.vendor.id,
        },
        mounts: [
          {
            hostPath: resolve(bundle.configDirectory),
            containerPath: IMPOSTER_CONFIG_DIRECTORY,
            readOnly: true,
          },
        ],
        ports: [
          {
            hostAddress: "127.0.0.1",
            containerPort: IMPOSTER_CONTAINER_PORT,
          },
        ],
      });
      containerId = handle.id;

      const hostPort = await this.engine.resolveHostPort(
        containerId,
        IMPOSTER_CONTAINER_PORT,
      );
      const baseUrl = `http://127.0.0.1:${hostPort}`;
      const status = await this.waitForReady(baseUrl, options);
      let stopped = false;

      return {
        containerId,
        containerName,
        baseUrl,
        providerBaseUrl: `${baseUrl}${bundle.manifest.endpoint.basePath}`,
        status,
        bundle,
        logs: async () =>
          sanitizeRuntimeLogs(await this.engine.logs(containerId as string)),
        collectLedger: async () =>
          parseProviderCallLedger(await this.engine.logs(containerId as string)),
        stop: async () => {
          if (stopped) {
            return;
          }
          stopped = true;
          await this.engine.remove(containerId as string);
        },
      };
    } catch (error) {
      let runtimeLogs: string | undefined;
      if (containerId) {
        try {
          runtimeLogs = sanitizeRuntimeLogs(await this.engine.logs(containerId));
        } catch {
          runtimeLogs = undefined;
        }
        try {
          await this.engine.remove(containerId);
        } catch {
          // Keep the original startup error; cleanup is best-effort here.
        }
      }

      throw new RuntimeStartError("Unable to start Imposter vendor runtime.", {
        ...(containerId ? { containerId } : {}),
        ...(runtimeLogs ? { runtimeLogs } : {}),
        cause: error,
      });
    }
  }

  private async waitForReady(
    baseUrl: string,
    options: RuntimeStartOptions,
  ): Promise<ImposterStatus> {
    const timeoutMs = options.startupTimeoutMs ?? 30_000;
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? new Error("Runtime startup aborted.");
      }

      try {
        const response = await this.fetcher(
          `${baseUrl}${IMPOSTER_STATUS_PATH}`,
          options.signal ? { signal: options.signal } : undefined,
        );
        if (response.ok) {
          const status = (await response.json()) as ImposterStatus;
          if (status.status === "ok") {
            return status;
          }
        }
      } catch (error) {
        lastError = error;
      }

      await sleep(pollIntervalMs, options.signal);
    }

    throw new Error(`Imposter did not become ready within ${timeoutMs}ms.`, {
      cause: lastError,
    });
  }
}

function makeContainerName(vendorId: string, bundleId: string): string {
  const safeVendor = vendorId.toLowerCase().replace(/[^a-z0-9_.-]+/gu, "-");
  return `testy-${safeVendor}-${bundleId.slice(0, 12)}`.slice(0, 63);
}

async function sleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Operation aborted.");
  }

  await new Promise<void>((resolveSleep, rejectSleep) => {
    const timer = setTimeout(resolveSleep, durationMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      rejectSleep(signal?.reason ?? new Error("Operation aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    timer.unref?.();
  });
}
