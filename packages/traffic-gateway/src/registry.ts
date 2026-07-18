import { randomBytes, randomUUID } from "node:crypto";

import type { RunId } from "@testy/shared-types";

import { fingerprint, tokenMatches } from "./crypto.js";
import { gatewayError } from "./errors.js";
import { assertReservedSyntheticIpv4 } from "./synthetic-ip.js";
import type {
  AuthorizedGatewayRoute,
  CreateGatewayRouteInput,
  GatewayLedgerEntry,
  GatewayRouteBinding,
  GatewayRouteRegistry,
} from "./types.js";

interface StoredRoute extends AuthorizedGatewayRoute {
  readonly tokenHash: string;
  readonly expiresAtMs: number;
  readonly ledger: GatewayLedgerEntry[];
}

export interface InMemoryGatewayRouteRegistryOptions {
  readonly allowedTargetOrigins: readonly string[];
  readonly blockedProviderHosts?: readonly string[];
  readonly maxRouteTtlMs?: number;
  readonly now?: () => Date;
}

const defaultBlockedProviderHosts = [
  "ipinfo.io",
  "api.ipinfo.io",
  "hunter.io",
  "api.hunter.io",
  "apollo.io",
  "api.apollo.io",
];

export class InMemoryGatewayRouteRegistry implements GatewayRouteRegistry {
  private readonly routes = new Map<string, StoredRoute>();
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly blockedHosts: readonly string[];
  private readonly maxRouteTtlMs: number;
  private readonly now: () => Date;
  private sequence = 0;

  public constructor(options: InMemoryGatewayRouteRegistryOptions) {
    this.allowedOrigins = new Set(options.allowedTargetOrigins.map(normalizeOrigin));
    this.blockedHosts = [
      ...defaultBlockedProviderHosts,
      ...(options.blockedProviderHosts ?? []),
    ].map((value) => value.toLowerCase());
    this.maxRouteTtlMs = options.maxRouteTtlMs ?? 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  public createRoute(
    input: CreateGatewayRouteInput,
    proxyOrigin: string,
  ): GatewayRouteBinding {
    assertReservedSyntheticIpv4(input.syntheticIp);
    if (!Number.isInteger(input.ttlMs) || input.ttlMs < 1 || input.ttlMs > this.maxRouteTtlMs) {
      throw gatewayError("route-ttl-invalid", 400, "Gateway route TTL is outside the allowed range.");
    }
    const targetOrigin = normalizeOrigin(input.targetOrigin);
    const hostname = new URL(targetOrigin).hostname.toLowerCase();
    if (this.blockedHosts.some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`))) {
      throw gatewayError("provider-destination-blocked", 403, "Real provider destinations are prohibited.");
    }
    if (!this.allowedOrigins.has(targetOrigin)) {
      throw gatewayError("target-origin-not-allowed", 403, "Target origin is not allowlisted.");
    }
    const now = this.now();
    const routeId = `gw-${randomUUID()}`;
    const routeToken = randomBytes(32).toString("base64url");
    const expiresAtMs = now.getTime() + input.ttlMs;
    const targetOriginFingerprint = fingerprint(targetOrigin);
    const syntheticIpFingerprint = fingerprint(input.syntheticIp);
    const stored: StoredRoute = {
      routeId,
      runId: input.runId,
      targetOrigin,
      syntheticIp: input.syntheticIp,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
      targetOriginFingerprint,
      syntheticIpFingerprint,
      tokenHash: fingerprint(routeToken),
      ledger: [],
    };
    this.routes.set(routeId, stored);
    return {
      routeId,
      runId: input.runId,
      proxyBaseUrl: `${normalizeOrigin(proxyOrigin)}/v1/proxy/${encodeURIComponent(routeId)}`,
      routeToken,
      expiresAt: stored.expiresAt,
      targetOriginFingerprint,
      syntheticIpFingerprint,
    };
  }

  public authorize(
    routeId: string,
    routeToken: string | undefined,
    runId: string | undefined,
  ): AuthorizedGatewayRoute {
    const route = this.routes.get(routeId);
    if (!route) throw gatewayError("route-not-found", 404, "Gateway route was not found.");
    if (this.now().getTime() >= route.expiresAtMs) {
      this.routes.delete(routeId);
      throw gatewayError("route-expired", 410, "Gateway route has expired.");
    }
    if (runId !== undefined && runId !== route.runId) {
      throw gatewayError("route-run-mismatch", 409, "Gateway route does not belong to this run.");
    }
    if (!tokenMatches(route.tokenHash, routeToken)) {
      throw gatewayError("route-token-invalid", 401, "Gateway route token is invalid.");
    }
    return {
      routeId: route.routeId,
      runId: route.runId,
      targetOrigin: route.targetOrigin,
      syntheticIp: route.syntheticIp,
      expiresAt: route.expiresAt,
      targetOriginFingerprint: route.targetOriginFingerprint,
      syntheticIpFingerprint: route.syntheticIpFingerprint,
    };
  }

  public deleteRoute(routeId: string): boolean {
    return this.routes.delete(routeId);
  }

  public listLedger(routeId: string): readonly GatewayLedgerEntry[] {
    return this.routes.get(routeId)?.ledger.map((entry) => ({ ...entry })) ?? [];
  }

  public record(
    entry: Omit<GatewayLedgerEntry, "sequence" | "occurredAt">,
  ): GatewayLedgerEntry {
    const recorded: GatewayLedgerEntry = {
      sequence: (this.sequence += 1),
      occurredAt: this.now().toISOString(),
      ...entry,
    };
    this.routes.get(entry.routeId)?.ledger.push(recorded);
    return recorded;
  }
}

export function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw gatewayError("origin-invalid", 400, "Origin is invalid.");
  }
  if (!(["http:", "https:"] as const).includes(url.protocol as "http:" | "https:")) {
    throw gatewayError("origin-protocol-invalid", 400, "Only HTTP and HTTPS origins are supported.");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw gatewayError("origin-invalid", 400, "Target must be an origin without credentials, path, query, or fragment.");
  }
  return url.origin;
}

export function asRunId(value: string): RunId {
  return value as RunId;
}
