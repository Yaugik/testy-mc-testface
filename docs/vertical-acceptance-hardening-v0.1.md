# Vertical acceptance hardening v0.1

This slice turns the Customer Alpha vertical scenario from integration wiring into an explicit acceptance contract for tracking delivery, idempotency, tenant isolation, concurrent-run isolation, and cleanup.

## Tracking delivery

The browser runner accepts test-support external scripts supplied by the target adapter. Scripts must use absolute HTTP or HTTPS URLs and cannot contain credentials or fragments. They are loaded after each synthetic document navigation so the target tracking integration executes on the real generated site.

Expected browser requests are reduced to privacy-safe checks:

- stable request ID;
- optional HTTP method;
- sanitized URL fingerprint;
- matched, successful, and failed counts.

Raw tracking URLs are not written to request-check observations. A browser action loads the `trackingScriptUrl` returned by `target.prepare-run` and persists a `browser-request-check` observation for each execution.

## Idempotency and tenant isolation

`scenarios/customer-alpha-vertical.yaml` executes the same lead-capture journey twice with execution IDs `initial` and `duplicate`. Each execution uses an isolated artifact namespace while sharing the same prepared target run.

The acceptance assertions require:

- both browser submissions to pass;
- two successful tracking-script deliveries;
- exactly one call to each configured synthetic provider;
- exact provider order;
- one company and one score after duplicate input;
- the primary tenant to see the result;
- the prepared control tenant to remain hidden;
- two form submissions and two browser reports;
- no rejected or failed gateway traffic.

Tenant visibility booleans are derived from the prepared target output and collected outcome. Scenario configuration therefore contains no generated tenant IDs.

## Concurrent-run isolation

The platform action package exposes read-only diagnostics for active run IDs. Its concurrency test creates two run contexts simultaneously, proves they receive different runtime endpoints, performs reverse cleanup, and requires the active-run set to become empty.

Runtime and synthetic-site cleanup callbacks clear their in-memory resource references. The final run-state cleanup fails when a runtime or site remains attached, converting an otherwise passing scenario into a cleanup failure.

## Commands

```bash
pnpm acceptance:validate
pnpm acceptance:test
pnpm acceptance:run
```

`acceptance:run` requires the same live PostgreSQL, Docker, Playwright, Traffic Gateway, and approved GL-EYE test-support environment as the complete vertical scenario.

## Verification boundary

The focused pass covers strict TypeScript compatibility for the changed contracts, request-summary behavior, YAML parsing, derived tenant visibility, concurrent run-state isolation, and reverse cleanup semantics. A live end-to-end acceptance run remains environment-dependent. CI and GitHub Actions are not part of this workflow.
