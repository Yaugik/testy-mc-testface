import type { RunId } from "@testy/shared-types";

import { gatewayError } from "./errors.js";
import type {
  CreateGatewayRouteInput,
  GatewayLedgerEntry,
  GatewayRouteBinding,
} from "./types.js";

export interface GatewayAdminClientOptions {
  readonly baseUrl: string;
  readonly adminToken: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class GatewayAdminClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(private readonly options: GatewayAdminClientOptions) {
    this.baseUrl = new URL(options.baseUrl).origin;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  public async createRoute(input: CreateGatewayRouteInput): Promise<GatewayRouteBinding> {
    return this.request<GatewayRouteBinding>("POST", "/v1/routes", input);
  }

  public async deleteRoute(routeId: string): Promise<void> {
    await this.request<void>("DELETE", `/v1/routes/${encodeURIComponent(routeId)}`, undefined, [204, 404]);
  }

  public async getLedger(routeId: string): Promise<readonly GatewayLedgerEntry[]> {
    const result = await this.request<{ readonly entries: readonly GatewayLedgerEntry[] }>(
      "GET",
      `/v1/routes/${encodeURIComponent(routeId)}/ledger`,
    );
    return result.entries;
  }

  public async health(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(new URL("/v1/health", this.baseUrl), {
        signal: controller.signal,
      });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    acceptedStatuses: readonly number[] = [200, 201],
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(new URL(path, this.baseUrl), {
        method,
        headers: {
          authorization: `Bearer ${this.options.adminToken}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!acceptedStatuses.includes(response.status)) {
        throw gatewayError("gateway-admin-request-failed", 502, `Gateway admin request failed with status ${response.status}.`);
      }
      if (response.status === 204 || response.status === 404) return undefined as T;
      return await response.json() as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function gatewayRouteInput(
  runId: RunId,
  targetOrigin: string,
  syntheticIp: string,
  ttlMs: number,
): CreateGatewayRouteInput {
  return { runId, targetOrigin, syntheticIp, ttlMs };
}
