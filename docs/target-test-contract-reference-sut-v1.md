# Target Test Contract v1 and reference SUT

This slice removes GL-EYE availability as a prerequisite for platform integration work. `@testy/reference-sut` implements the same authenticated black-box test-support lifecycle expected from a future GL-EYE test environment.

## Contract artifact

The machine-readable contract is:

```text
contracts/target-test-support-v1.openapi.yaml
```

The lifecycle endpoints are:

```text
POST   /test-support/v1/runs
PUT    /test-support/v1/runs/:targetRunId/vendor-endpoints
PUT    /test-support/v1/runs/:targetRunId/site
POST   /test-support/v1/runs/:targetRunId/observations
GET    /test-support/v1/runs/:targetRunId/observations/:observationId
GET    /test-support/v1/runs/:targetRunId/outcome
DELETE /test-support/v1/runs/:targetRunId
```

All lifecycle endpoints require a bearer service token. Run preparation is idempotent by platform run ID. Observation creation and cleanup are also idempotent.

The reference SUT additionally exposes gateway-facing traffic endpoints under `/test-support/v1/traffic/*`. Credentials are not accepted from scenario YAML; these endpoints are intended to be reachable only through an isolated deployment boundary or a run-scoped Traffic Gateway route.

## Reference business flow

The reference SUT implements a deliberately small product-neutral flow:

1. Accept one synthetic visitor event.
2. Call the injected IPinfo endpoint.
3. Call the injected Apollo endpoint.
4. Call the injected Hunter endpoint.
5. Materialize one company and one score.
6. Make the result visible only to the prepared primary tenant.
7. Treat replayed event IDs or idempotency keys as duplicates.
8. Expose a sanitized outcome and processing observation.

It contains no GL-EYE source code, database behavior, queue behavior, or internal business logic.

## Sanitized outcome

The reference outcome contains only externally assertable and privacy-safe values:

- target run ID;
- visible tenant IDs;
- company and score counts;
- duplicate-event count;
- SHA-256 company fingerprint;
- score rule version;
- enrichment status;
- provider call sequence;
- maximum observed negative-suite burst concurrency.

Raw contacts, credentials, request bodies and provider response payloads are not retained or returned.

## Mutation switches

Mutation switches make assertion quality testable without modifying platform code:

```text
TESTY_REFERENCE_MUTATE_TENANT_ISOLATION=true
TESTY_REFERENCE_MUTATE_IDEMPOTENCY=true
TESTY_REFERENCE_MUTATE_ENRICHMENT=true
```

They respectively:

- expose the result to the control tenant;
- create an extra score on duplicate input;
- skip Apollo and Hunter enrichment.

The normal vertical assertions should fail when the relevant mutation is enabled.

## Commands

```bash
pnpm reference:test
pnpm reference:start
pnpm reference:run
```

A host-native preparation can point the existing GL-EYE-compatible adapter at the reference SUT:

```text
GL_EYE_BASE_URL=http://127.0.0.1:8080
GL_EYE_ENVIRONMENT=local
GL_EYE_TEST_SUPPORT_TOKEN=reference-sut-token-local
GL_EYE_ALLOWED_ORIGINS=http://127.0.0.1:8080
TESTY_GATEWAY_ALLOWED_TARGET_ORIGINS=http://127.0.0.1:8080
```

The existing `customer-alpha-vertical` scenario then exercises the reference target through the same adapter boundary intended for GL-EYE.

## Verification boundary

The focused conformance tests cover:

- authentication;
- idempotent run preparation;
- vendor and site configuration;
- observation lifecycle;
- injected tracking script generation;
- provider call order;
- company and score idempotency;
- tenant isolation;
- cleanup;
- malformed JSON and form handling;
- deterministic transient retries;
- concurrent burst observation;
- mutation switches.

This slice does not claim that the current full Docker Compose topology can execute Chromium and nested Imposter containers. That deployment-topology hardening remains separate work.
