# ADR 0001: Imposter runtime for the MVP spike

- **Status:** Accepted for internal development and CI spike; distribution review required
- **Date:** 2026-07-18
- **Decision owners:** Platform engineering, security, legal

## Context

The first implementation sprint requires an automated compatibility suite for request matching, deterministic responses, readiness, shutdown, request capture, and forced cleanup. The platform must avoid coupling its vendor DSL to a specific simulator implementation.

The Imposter documentation recommends the core `outofcoffee/imposter` image for REST and OpenAPI mocks. The latest stable 4.x release available during this decision is `4.9.2`; 5.x images are still published as beta.

The Imposter JVM engine licence is GNU LGPL version 3 with the Commons Clause condition. This is not treated as an unconditional approval to redistribute or embed the image in a commercial offering.

## Decision

1. Use `outofcoffee/imposter:4.9.2` for the internal MVP compatibility spike.
2. Keep all lifecycle operations behind `ImposterRuntimeManager`.
3. Mount generated configuration read-only and publish the runtime only on loopback.
4. Require idempotent forced cleanup after startup, execution, cancellation, and failure.
5. Store only sanitized request fingerprints in the provider call ledger.
6. Do not publish, mirror, bundle, or resell the image until legal and security owners approve the distribution model.
7. Before this ADR moves to `Accepted for release`, record the full multi-architecture manifest digest and approved per-platform digests in a runtime lock file. A mutable tag alone is not sufficient for the release gate.

## Compatibility scope for the spike

The automated suite must prove or explicitly reject:

- path and header matching;
- JSON responses from mounted fixtures;
- fixed delays;
- ordered response sequences;
- shared counters and state transitions;
- authentication success and failure;
- request capture with redaction;
- readiness and bounded startup;
- normal shutdown and forced cleanup;
- Docker execution in CI.

## Consequences

- The initial spike can proceed without committing the vendor DSL to Imposter-specific syntax.
- A later engine replacement remains possible through the runtime-neutral execution model.
- Release readiness remains blocked until image digests and licensing/distribution approval are recorded.
- Unsupported fault primitives must be removed from schema v1 rather than emulated with arbitrary user-authored JavaScript.

## Sources reviewed

- Imposter Docker documentation: https://docs.imposter.sh/run_imposter_docker/
- Imposter 4.9.2 release: https://github.com/imposter-project/imposter-jvm-engine/releases/tag/v4.9.2
- Imposter JVM engine licence: https://github.com/imposter-project/imposter-jvm-engine/blob/main/LICENSE
- Docker Hub core image tags: https://hub.docker.com/r/outofcoffee/imposter/tags
