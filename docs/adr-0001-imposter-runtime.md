# ADR 0001: Imposter runtime boundary

- **Status:** Provisional
- **Date:** 2026-07-16

## Decision

Use the Imposter core Docker image behind platform-owned compiler and runtime
interfaces. Vendor authors do not write native Imposter configuration.

The compiler emits deterministic JSON configuration and response assets. The
runtime manager owns Docker startup, readiness, log capture and cleanup. No other
platform package invokes Docker or relies on Imposter configuration fields.

## Rationale

The official runtime supports the native request matching, authentication,
response, delay, failure and status primitives needed by the first provider
slice. Keeping these details behind `@testy/vendor-compiler` and
`@testy/vendor-runtime` preserves replaceability.

## Consequences

- Unsupported DSL features fail compilation explicitly.
- Timeout is currently approximated using delay plus `CloseConnection`.
- State transitions remain declared but inactive until the store/script spike is
  completed.
- The temporary major-version image tag must be replaced with a digest-pinned
  image before release approval.
