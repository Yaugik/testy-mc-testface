# Direct HTTP traffic generator and negative suite v0.1

The traffic generator exercises approved target endpoints through the existing run-scoped Traffic Gateway. Scenario input cannot choose an origin, route ID, run ID, or route token. Those values come from the gateway route allocated for the active run.

## Scenario actions

```text
traffic.send
traffic.repeat
traffic.burst
```

`traffic.send` executes one bounded request. `traffic.repeat` expands one request into uniquely identified instances while preserving a configured idempotency key. `traffic.burst` executes an explicit request list with a bounded worker pool.

An action fails when its declared expectations are not met. Evidence is persisted before the action fails, so reports retain the sanitized attempt history.

## Request model

A request defines:

- a stable synthetic ID;
- a relative path under the approved gateway route;
- an HTTP method;
- optional non-credential headers;
- JSON, deliberately malformed JSON, form, or raw synthetic body content;
- an optional synthetic idempotency key;
- a per-request timeout or client-abort delay;
- deterministic retry attempts, delay, backoff, status selection, and network-error behavior;
- expected status codes, network failure, duration bounds, and attempt count.

Absolute request URLs, fragments, route-control headers, hop-by-hop headers, credential-bearing headers, unsafe domains, non-documentation IP addresses, real email domains, private keys, and recognized live credential formats are rejected.

The generator uses a standards-compliant HTTP client. It supports semantically malformed headers and payloads, missing headers, spoofed attribution headers, and client disconnects. It intentionally does not generate invalid wire framing, CRLF injection, or arbitrary raw TCP payloads.

## Safety and load bounds

Default limits are:

- 100 requests per batch, with a hard configurable ceiling of 1,000;
- concurrency of 10, with a hard ceiling of 50;
- 64 KiB request and response bodies;
- 120-second request timeout;
- 300-second batch duration;
- 10 attempts and 60-second retry delay.

Redirects are not followed. Parent scenario cancellation stops delays and requests. A batch-level timer cancels active work and produces bounded failed summaries for pending requests.

## Evidence

Request evidence contains only:

- request ID and method;
- SHA-256 path and payload fingerprints;
- attempt number and timing;
- status code or safe outcome code;
- response byte count and fingerprint;
- scheduled retry delay;
- expectation failure codes.

Raw paths, queries, headers, bodies, route tokens, responses, and credentials are not written to traffic observations.

The Control Plane persists:

- `traffic-request-summary` for every request instance;
- `traffic-batch-summary` for repeat and burst aggregates.

## Negative-case suite

`scenarios/http-negative-suite.yaml` covers:

- malformed JSON;
- malformed form content;
- supplied source-IP spoof headers;
- a client disconnect;
- three concurrent duplicate submissions using one idempotency key;
- a six-request burst capped at two concurrent requests;
- a deterministic 503/502/504 retry sequence that succeeds on attempt three;
- gateway-ledger verification for unexpected egress.

The configured target must expose approved test-support endpoints below `/test-support/v1/traffic/` with the response behavior described by the scenario. Authentication must be supplied by the target adapter or deployment boundary, not embedded in scenario YAML.

## Commands

```bash
pnpm traffic:test
pnpm traffic:validate
pnpm traffic:run
```

`traffic:run` requires the Traffic Gateway, Control Plane, PostgreSQL, and a compatible approved target test environment.

## Verification boundary

Focused local verification covers strict TypeScript compatibility, real HTTP forwarding through the Traffic Gateway, synthetic attribution, spoof-header stripping, malformed payloads, deterministic retries, idempotency-key reuse, concurrency caps, client-abort handling, route/run isolation, privacy validation, and fingerprint-only evidence. A live GL-EYE negative-suite execution remains environment-dependent.
