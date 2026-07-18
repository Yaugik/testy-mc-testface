# Reference SUT compatibility follow-up

This follow-up selectively preserves the useful behavior from the divergent
`agent/reference-sut-contract-v1` branch without replacing the canonical target
contract and executable topology now on `main`.

## Retained behavior

The production entrypoint for `@testy/reference-sut` now wraps the canonical
reference SUT with:

- explicit `401 Unauthorized` responses for missing or invalid service tokens;
- browser CORS and `OPTIONS` handling for direct traffic endpoints;
- an absolute tracking-ingestion URL so scripts loaded by the synthetic site post
  to the reference SUT rather than the document origin;
- a simple `text/plain` tracking request that avoids an unnecessary browser
  preflight;
- deterministic malformed JSON, malformed form, attribution, slow response,
  idempotency, bounded burst, and transient retry probes used by the HTTP negative
  suite.

## Canonical boundary

The following remain canonical from the newer implementation:

- `contracts/target-test-support-v1.openapi.yaml`;
- the run-scoped ingestion token model;
- target capability discovery;
- rich sanitized outcomes and mutation controls;
- the Docker Compose conformance topology.

The old branch must not be merged wholesale because its reference SUT and OpenAPI
contract are competing implementations that diverged before the canonical target
contract and local topology were completed.
