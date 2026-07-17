# Assertion and reporting engine v0.1

This slice adds the durable assertion and reporting boundary for scenario runs. Assertions are authored declaratively, materialized into the resolved scenario hash, evaluated while the run is in `ASSERTING`, persisted, and regenerated into privacy-safe JSON or HTML reports.

## Assertion model

Supported assertion types:

- `provider-call-count`
- `provider-call-order`
- `browser-journey-passed`
- `browser-action`
- `observation`
- `observation-count`
- `step-passed`
- `artifact-present`
- `no-unexpected-external-calls`

Assertions use severity `error` or `warning`. Required error failures fail the scenario during `ASSERTING`; warnings remain visible without changing an otherwise passing outcome.

The resolver validates assertion IDs and constraints, substitutes scenario variables, includes assertions in the resolved scenario hash, and appends the reserved `assertions-evaluate` task. Action names now support dot-qualified platform actions such as `gateway.create-route`.

## Durable evidence and reports

The run repository persists provider calls, browser actions, observations, artifacts, assertion results, lifecycle steps, and timeline events. Migration `003_assertion_reporting.sql` adds assertion type/severity, stable observation identifiers, and report-query indexes.

`@testy/reporting` regenerates deterministic privacy-safe JSON and escaped HTML from persisted records. It redacts sensitive metadata keys and credentials, bounds nested values, fingerprints remote artifact locations, and emits a deterministic content hash.

```text
GET /v1/runs/:runId/report
GET /v1/runs/:runId/report?format=html
```

`Accept: text/html` also selects HTML.

## Commands

```bash
pnpm assertion:validate
pnpm assertion:test
pnpm reporting:test
```

Verification covered strict TypeScript, schema parsing, direct assertion evaluation, required/warning behavior, deterministic report hashing, HTML escaping, redaction, report regeneration, and in-memory run-service behavior. Live PostgreSQL and complete vendor/browser/GL-EYE execution remain environment-dependent. CI and GitHub Actions are not part of this workflow.
