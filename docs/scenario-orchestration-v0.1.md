# Scenario orchestration and run lifecycle v0.1

This slice adds the persistent lifecycle boundary that connects configuration-driven
vendor, browser, target, observation, and assertion actions without hard-coding those
systems into the Control Plane.

## Scenario model

`@testy/scenario-engine` loads and resolves versioned scenario YAML. A scenario contains
six executable phases:

1. allocate;
2. compile;
3. configure;
4. run;
5. observe;
6. assert.

The engine transitions through the corresponding persistent run statuses. Validation is
performed before execution and the complete resolved scenario plus SHA-256 content hash
is stored with the run.

Scenario steps support:

- ordered tasks;
- parallel groups with sibling cancellation on failure;
- bounded repetition;
- output and variable conditions;
- poll-until actions;
- explicit action and scenario timeouts;
- fixed or exponential retry delay;
- reusable fragments;
- reverse-order compensation;
- registered idempotent cleanup callbacks;
- cancellation through `AbortSignal`.

Actions are supplied through a registry. Future vendor, browser, gateway, target,
observation, and assertion integrations register handlers rather than adding branches to
the engine.

## Lifecycle and cleanup

The passing path is:

```text
CREATED -> VALIDATING -> ALLOCATING -> COMPILING -> CONFIGURING
        -> RUNNING -> OBSERVING -> ASSERTING -> PASSED
        -> CLEANUP -> PASSED
```

Failure and cancellation also pass through `CLEANUP`, then return to their persisted
terminal outcome. Cleanup is invoked in reverse registration order and can safely be
called after partial setup.

An active cancellation closes the shared abort signal immediately. If the Control Plane
restarts, active persisted runs are recovered deterministically as failed, or cancelled
when a cancellation request was already stored. The interruption status is retained in
sanitized metadata and timeline events.

## Persistence

Migration `002_scenario_lifecycle.sql` extends `test_runs` with the resolved scenario,
outcome, and cancellation timestamp. It adds:

- `run_steps`;
- `timeline_events`;
- `resource_leases`;
- `runtime_instances`;
- `provider_calls`;
- `browser_actions`;
- `observations`;
- `assertion_results`;
- `artifacts`.

The PostgreSQL repository writes step attempts with upsert semantics, appends ordered
timeline records, and regenerates the run report from persisted sanitized records.

## Control Plane APIs

```text
GET  /v1/scenarios
GET  /v1/scenarios/:scenarioId
POST /v1/scenarios/validate
POST /v1/runs
GET  /v1/runs/:runId
POST /v1/runs/:runId/cancel
GET  /v1/runs/:runId/timeline
GET  /v1/runs/:runId/report
GET  /v1/runs/:runId/artifacts
```

`POST /v1/runs` accepts either an inline scenario or `{ "scenarioId": "..." }` and returns `202` after the resolved run has been persisted. Execution then
continues under an in-process controller while every lifecycle transition and step update
is committed through the repository.

## Local commands

Validate the sample scenario:

```bash
pnpm scenario:validate
```

Run it against the built-in deterministic action registry:

```bash
pnpm scenario:run
```

The `testy` CLI also exposes `validate scenario`, `run`, `status`, `timeline`, `report`, `artifacts`, `cancel`, and `doctor` commands through `TESTY_CONTROL_PLANE_URL`.

The built-ins are intentionally limited to no-op, value, delay, controlled failure, and
cleanup-registration actions. They exercise the engine without pretending the GL-EYE
adapter exists before the gateway and target-integration slice.

## Verification boundary

Unit coverage includes lifecycle transition rules, fragment expansion, parallel steps,
conditions, polling, cancellation, and cleanup. Control Plane route tests use an injected
run service, so HTTP behavior does not require PostgreSQL.

The PostgreSQL migration and repository SQL are reviewed statically in this slice. A real
database migration/restart test remains environment-dependent and must be performed in a
local Compose environment. CI and GitHub Actions are not part of this workflow.
