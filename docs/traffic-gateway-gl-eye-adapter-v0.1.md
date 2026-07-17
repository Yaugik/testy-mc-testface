# Traffic Gateway and GL-EYE target adapter v0.1

This slice adds the black-box boundary between run-scoped test traffic and the system under test. It does not access GL-EYE databases, queues, Redis, framework classes, or undocumented internal endpoints.

## Closed reverse-proxy model

`@testy/traffic-gateway` is deliberately not an open proxy. A gateway route binds:

- one run ID;
- one exact allowlisted target origin;
- one RFC 5737 synthetic visitor address;
- one random route token stored only as a SHA-256 hash;
- one expiry timestamp;
- one privacy-safe request ledger.

The caller selects only a path under the bound origin. Absolute destination URLs are never accepted. Known real IPinfo, Apollo, and Hunter hosts are blocked even if accidentally added to the generic target allowlist.

Supported synthetic ranges are:

- `192.0.2.0/24`;
- `198.51.100.0/24`;
- `203.0.113.0/24`.

## Header and egress policy

Before forwarding, the gateway removes caller-supplied `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, common CDN client-IP headers, hop-by-hop headers, and every `X-Testy-*` header. It then applies the leased address through freshly generated `Forwarded` and `X-Forwarded-For` values.

The target origin is checked twice: once against the gateway process allowlist and once against the default prohibited-provider list. Expired routes, invalid tokens, and mismatched run IDs are rejected before any outbound request.

## Privacy-safe ledger

Gateway records contain only:

- run and route identifiers;
- method;
- SHA-256 path, target-origin, synthetic-IP, and optional body fingerprints;
- status and duration;
- sanitized outcome and reason codes.

Query values, request bodies, authorization headers, cookies, and raw visitor IP values are not retained.

## Gateway management

The standalone gateway exposes:

```text
GET    /v1/health
POST   /v1/routes
DELETE /v1/routes/:routeId
GET    /v1/routes/:routeId/ledger
ANY    /v1/proxy/:routeId/*
```

Management routes require the gateway admin bearer token. Proxy routes require the per-route `X-Testy-Route-Token`; an optional `X-Testy-Run-Id` must match and is consumed rather than forwarded.

## Target adapter contract

`@testy/target-adapter` defines the reusable target contract:

- prepare a run;
- configure run-specific vendor endpoints;
- configure the synthetic site and gateway binding;
- start and poll observation;
- collect a sanitized outcome;
- clean the run idempotently;
- clean a persisted target resource after Control Plane restart.

The deterministic `FakeTargetAdapter` proves two-run tenant isolation and cleanup without pretending to be GL-EYE.

## GL-EYE implementation

`@testy/gl-eye-adapter` calls only the authenticated test-support HTTP contract under `/test-support/v1`. Every endpoint template is configurable and path-confined. The adapter refuses production, rejects non-allowlisted origins, streams responses through a hard size limit, follows no redirects, propagates cancellation, and never logs the test-support credential or response payload.

Default contract paths are:

```text
POST   /test-support/v1/runs
PUT    /test-support/v1/runs/:targetRunId/vendor-endpoints
PUT    /test-support/v1/runs/:targetRunId/site
POST   /test-support/v1/runs/:targetRunId/observations
GET    /test-support/v1/runs/:targetRunId/observations/:observationId
GET    /test-support/v1/runs/:targetRunId/outcome
DELETE /test-support/v1/runs/:targetRunId
```

These are an explicit adapter contract that GL-EYE must implement in an approved test environment; they are not inferred from application internals.

## Scenario actions

When gateway and GL-EYE configuration are complete, the Control Plane registers:

```text
gateway.create-route
gateway.collect-ledger
target.prepare-run
target.configure-vendors
target.configure-site
target.start-observation
target.wait-for-completion
target.collect-outcome
target.cleanup-run
```

Gateway-route and target-run resource leases include restart cleaners. Route creation is retry-safe: a route created before a transient lease-persistence failure is reused and the missing lease is registered on the next attempt. Vendor endpoint configuration rejects known real provider hosts and permits only local, private, internal, or approved synthetic runtime names.

If integration variables are absent or contain only whitespace, the Control Plane remains usable with only the deterministic built-in actions. Any non-empty partial integration configuration is rejected at startup.

## Commands

```bash
pnpm gateway:start
pnpm gateway:test
pnpm target:test
pnpm scenario:validate -- ../../scenarios/gateway-target-smoke.yaml
```

`docker compose up` also starts the gateway on port 3100. Target integration remains disabled until the complete GL-EYE and gateway client configuration is supplied to the Control Plane.

## Verification boundary

Unit coverage targets reserved-IP enforcement, closed-origin routing, real-provider blocking, expiry and token checks, spoofed-header stripping, privacy-safe ledger output, two-run target isolation, idempotent cleanup, authenticated GL-EYE contract calls, and partial-configuration rejection.

A real GL-EYE test-support deployment was not available in this environment. Release verification must run two isolated target tenants, prove the synthetic source attribution at GL-EYE, confirm run-specific provider endpoints, and fail on any unexpected outbound call. CI and GitHub Actions are not part of this workflow.
