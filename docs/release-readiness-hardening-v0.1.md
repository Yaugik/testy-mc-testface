# Release readiness and recovery hardening v0.1

This slice adds bounded operational maintenance to the Control Plane. It is separate from scenario execution so restart recovery, stale-resource cleanup, and artifact retention use the same durable records even when no run is active.

## Expired resource leases

Each maintenance cycle atomically claims a bounded set of expired `ACTIVE` leases. Claims are stored in PostgreSQL with an expiry so another Control Plane instance cannot process the same lease concurrently and an abandoned claim becomes eligible again.

For every claimed lease the maintenance service:

1. selects the cleaner registered for the resource type;
2. runs the idempotent cleaner;
3. marks the lease released on success;
4. clears the claim and stores only a SHA-256 error fingerprint on failure;
5. appends a sanitized timeline event to the owning run.

Cleanup attempts and the latest attempt timestamp are retained for diagnosis. Resource keys and raw cleaner errors are not copied into maintenance status responses or timeline metadata.

## Artifact retention

Artifact candidates are limited to terminal runs and files older than `TESTY_ARTIFACT_RETENTION_MS`. PostgreSQL claims candidates in bounded batches before filesystem deletion.

The local artifact cleaner resolves every artifact path below `GENERATED_RUNS_DIR`. Parent traversal, absolute locations outside the configured root, and attempts to delete the root itself are rejected. Canonical paths are checked before deletion so symlinked directories cannot escape the configured root. A missing file is treated as already deleted, after which the stale database record is removed.

Deletion failures release the claim and persist only a fingerprint. The next maintenance cycle can retry the record.

## Startup and scheduling

Control Plane startup now performs:

1. interrupted-run recovery;
2. one synchronous maintenance cycle;
3. periodic maintenance scheduling;
4. HTTP listener startup.

A failure in the initial cycle fails startup rather than declaring the service ready with unknown stale resources. Scheduled failures are logged through the existing sanitized error path. Shutdown stops the timer and waits for any active cycle before closing PostgreSQL.

## Configuration

```text
TESTY_MAINTENANCE_INTERVAL_MS=60000
TESTY_MAINTENANCE_BATCH_SIZE=100
TESTY_MAINTENANCE_CLAIM_TTL_MS=300000
TESTY_ARTIFACT_RETENTION_MS=604800000
TESTY_MAINTENANCE_ADMIN_TOKEN=
```

An interval of `0` disables periodic scheduling while preserving the startup cycle. The manual maintenance endpoint is disabled unless `TESTY_MAINTENANCE_ADMIN_TOKEN` is set to at least 16 characters.

## Operational endpoints

```text
GET  /v1/maintenance
POST /v1/maintenance/run
```

`GET /v1/maintenance` returns cycle state and aggregate counts. It does not expose resource keys, artifact paths, tokens, or raw errors.

`POST /v1/maintenance/run` requires `Authorization: Bearer <TESTY_MAINTENANCE_ADMIN_TOKEN>`. When no token is configured the endpoint returns `404` instead of enabling an unauthenticated administrative action.

## Commands

```bash
pnpm maintenance:test
pnpm maintenance:status
```

`maintenance:status` requires a running local Control Plane. A manual cycle can be requested through the authenticated HTTP endpoint.

## Verification boundary

Focused tests cover successful lease and artifact cleanup, missing-cleaner failure fingerprints, path confinement, bearer-token enforcement, configuration bounds, and concurrent-cycle coalescing. PostgreSQL claim SQL is designed around `FOR UPDATE SKIP LOCKED` and expiring claims.

A real PostgreSQL multi-instance claim test, Docker resource cleanup, and retention against a populated generated-runs directory remain environment-backed release checks. CI and GitHub Actions are not part of this workflow.
