# Vendor contract suites v0.1

Vendor contract suites provide one runtime-independent acceptance format for
IPinfo, Apollo, Hunter, and future provider packages. A suite is stored as
`contract.yaml` beside the vendor package and is validated before any container
is started.

## Suite model

A suite contains defaults and isolated cases. Each case contains ordered request
steps and optional final state/store expectations.

```yaml
schemaVersion: "1.0"
suiteId: example-contract
defaults:
  headers:
    X-Api-Key: test-example-key
  requestTimeoutMs: 2000
cases:
  - id: recovery
    steps:
      - id: unavailable
        request:
          method: POST
          path: /v1/match
          jsonBody:
            domain: recovery.example
        expect:
          status: 503
          matchedCase: recovery-sequence
          sequenceIndex: 1
    expect:
      stores:
        recovery:
          attempts: "1"
```

Supported request inputs are method, provider-relative path, headers, query
parameters, JSON body, and per-request timeout. Expectations can assert an HTTP
status or transport error plus the matched case, sequence index, and state before
or after the call.

Cases reset runtime state by default. A case can assert the final current state
and values in logical DSL stores. Physical Imposter store names remain generated
and run-scoped; contract authors use only logical names.

## Execution

The runner:

1. loads and validates the vendor package and `contract.yaml`;
2. compiles an isolated, suite-namespaced bundle;
3. starts Imposter and waits for readiness;
4. resets state before each case unless disabled;
5. sends each request with a generated correlation identifier;
6. verifies the immediate HTTP or transport result;
7. polls the privacy-safe provider ledger for match, sequence, and state data;
8. checks final logical store values;
9. emits a canonical JSON report;
10. removes the runtime in a `finally` block.

Run all current suites with:

```bash
pnpm vendor:contracts
```

## JSON-body matching

The compiler maps DSL fields such as `json.domain` and `json.company.name` to
Imposter `requestBody.jsonPath` matchers. Multiple JSON fields compile to an
`allOf` body matcher. Non-identifier property names use JsonPath bracket
notation.

## Current packages

- IPinfo: static lookup, authentication, timeout recovery, state transitions,
  sequence positions, and store assertions.
- Apollo: complete, partial, empty, conflict, suppression, invalid payload,
  quota, retryable/permanent failure, authentication, and recovery.
- Hunter: found, empty, partial, invalid/unverified, suppression, quota,
  authentication, conflict, and timeout recovery.

All fixture domains use the reserved `.example` namespace and credentials are
explicit synthetic test values.
