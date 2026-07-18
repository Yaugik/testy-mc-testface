import type { RunId } from "@testy/shared-types";

export interface CreateGatewayRouteInput {
  readonly runId: RunId;
  readonly targetOrigin: string;
  readonly syntheticIp: string;
  readonly ttlMs: number;
}

export interface GatewayRouteBinding {
  readonly routeId: string;
  readonly runId: RunId;
  readonly proxyBaseUrl: string;
  readonly routeToken: string;
  readonly expiresAt: string;
  readonly targetOriginFingerprint: string;
  readonly syntheticIpFingerprint: string;
}

export interface GatewayLedgerEntry {
  readonly sequence: number;
  readonly occurredAt: string;
  readonly routeId: string;
  readonly runId: RunId;
  readonly method: string;
  readonly pathFingerprint: string;
  readonly targetOriginFingerprint: string;
  readonly syntheticIpFingerprint: string;
  readonly requestBodyFingerprint?: string;
  readonly statusCode?: number;
  readonly durationMs: number;
  readonly outcome: "forwarded" | "rejected" | "failed";
  readonly reason?: string;
}

export interface AuthorizedGatewayRoute {
  readonly routeId: string;
  readonly runId: RunId;
  readonly targetOrigin: string;
  readonly syntheticIp: string;
  readonly expiresAt: string;
  readonly targetOriginFingerprint: string;
  readonly syntheticIpFingerprint: string;
}

export interface GatewayRouteRegistry {
  createRoute(input: CreateGatewayRouteInput, proxyOrigin: string): GatewayRouteBinding;
  authorize(routeId: string, routeToken: string | undefined, runId: string | undefined): AuthorizedGatewayRoute;
  deleteRoute(routeId: string): boolean;
  listLedger(routeId: string): readonly GatewayLedgerEntry[];
  record(entry: Omit<GatewayLedgerEntry, "sequence" | "occurredAt">): GatewayLedgerEntry;
}

export interface TrafficGatewayOptions {
  readonly host?: string;
  readonly port?: number;
  readonly adminToken: string;
  readonly allowedTargetOrigins: readonly string[];
  readonly blockedProviderHosts?: readonly string[];
  readonly maxRouteTtlMs?: number;
  readonly maxRequestBodyBytes?: number;
  readonly maxResponseBodyBytes?: number;
  readonly requestTimeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface TrafficGatewayBinding {
  readonly origin: string;
  readonly registry: GatewayRouteRegistry;
  stop(): Promise<void>;
}
