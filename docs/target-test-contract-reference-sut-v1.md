# Target Test-Support Contract v1 and Reference SUT

## Purpose

The platform must be testable before GL-EYE exists. The reference SUT is a deliberately small black-box system that implements the same authenticated target contract expected from future systems under test.

It proves the complete integration boundary without importing application code, reading application databases, inspecting queues, or depending on undocumented endpoints.

## Contract

The normative contract is:

```text
contracts/target-test-support-v1.openapi.yaml
```

Management endpoints require a service bearer token. Tracking ingestion uses a separate run-scoped token returned by `prepareRun`. Mutation flags are supported by the reference SUT only and are restricted to approved local/test environments.

The contract covers:

- Capability discovery and contract versioning.
- Idempotent target-run preparation.
- Primary and control tenant allocation.
- Vendor endpoint configuration.
- Synthetic-site configuration.
- Tracking script delivery.
- Run-scoped tracking ingestion.
- Observation start and polling.
- Rich sanitized outcomes.
- Idempotent cleanup.

## Rich outcome

The v1 outcome includes:

- Tenant visibility.
- Company and score counts.
- Processed and duplicate event counts.
- Stable company and score fingerprints.
- Provider provenance.
- Confidence classification.
- Suppression state.
- Processing warnings.

No raw company payload, contact payload, credential, cookie or submitted form value is returned.

## Reference processing behavior

For one accepted event the reference SUT:

1. Calls the configured IPinfo endpoint.
2. Calls the configured Apollo endpoint.
3. Calls the configured Hunter endpoint unless the skip-Hunter mutation is active.
4. Retries 429, 502, 503 and 504 responses up to three attempts.
5. Creates one stable company fingerprint.
6. Creates one stable score fingerprint.
7. Makes the result visible only to the primary tenant.
8. Treats repeated idempotency keys as duplicate events without repeating provider work.

## Mutation controls

The reference implementation supports deliberate defects so platform assertions can be proven:

- `leakControlTenant`
- `duplicateScore`
- `skipHunter`
- `unexpectedEgress`

A production-like adapter must not expose these controls.

## Control Plane selection

Use:

```text
TESTY_TARGET_ADAPTER=reference-sut
GL_EYE_BASE_URL=http://reference-sut:8080
GL_EYE_ENVIRONMENT=local
GL_EYE_TEST_SUPPORT_TOKEN=reference-sut-service-token-local
GL_EYE_ALLOWED_ORIGINS=http://reference-sut:8080
```

The legacy `GL_EYE_*` variable names are retained for compatibility in this slice. A later configuration cleanup should replace them with target-neutral names.

## Commands

```bash
pnpm reference-sut:build
pnpm reference-sut:test
pnpm reference-sut:start
pnpm target-contract:show
```

## Known deployment boundary

Adding the reference service does not by itself solve the existing Docker-in-Docker and Playwright-image issues in the Control Plane topology. Full Compose conformance still requires a supported runtime-management topology and target-reachable vendor endpoints. The reference SUT removes the dependency on GL-EYE implementation, but does not conceal those infrastructure tasks.

## GL-EYE handoff criteria

A future GL-EYE test-support implementation should:

- Implement the OpenAPI contract without mutation controls.
- Reject production and unapproved environments.
- Use idempotent run preparation and cleanup.
- Keep ingestion credentials run-scoped and short-lived.
- Expose only sanitized outcomes.
- Provide externally observable completion states.
- Accept run-specific vendor endpoints and trusted-gateway configuration.
- Pass the same adapter contract and platform conformance suite used by the reference SUT.
