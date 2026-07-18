# Initial startup and concurrency benchmark

## Objective

Measure whether the first-sprint foundation can start predictably and support isolated parallel runs before later phases depend on its lifecycle assumptions.

## Environment record

Every benchmark result must record:

- commit SHA;
- operating system and architecture;
- CPU and memory limits;
- Docker, Node.js, pnpm, PostgreSQL, and Imposter versions;
- container image digests;
- cold or warm image/cache state.

## Measurements

### Platform startup

Measure from `docker compose up -d` until:

- PostgreSQL accepts connections;
- migrations complete;
- Control Plane readiness returns success.

Record p50, p95, and maximum across ten clean starts.

### Imposter runtime startup

Measure from container creation until `/system/status` is ready. Run ten cold and ten warm starts. Record startup failures and forced-cleanup duration.

### Compilation

Compile the minimal IPinfo package 100 times. Verify identical content hashes and record p50/p95 duration and output size.

### Concurrency

Run 1, 2, 4, and 8 isolated runtime instances where host capacity permits. For each level:

- send the same synthetic lookup to every runtime;
- verify each ledger contains only its run ID;
- verify counters and state do not cross runtimes;
- cancel half the runs and verify the others continue;
- confirm all containers and generated directories are removed.

## Provisional engineering targets

These are investigation thresholds, not final service-level objectives:

- Control Plane ready within 30 seconds on the reference development machine;
- warm Imposter runtime ready within 10 seconds and cold within 30 seconds;
- minimal vendor compilation p95 below 500 ms;
- two concurrent runs complete without state leakage;
- forced cleanup completes within 10 seconds;
- zero orphaned containers or leases after the suite.

A missed threshold requires a recorded result and follow-up decision; it must not be hidden by increasing test timeouts without analysis.

## Result template

| Metric | Environment | Samples | p50 | p95 | Max | Pass/Fail | Notes |
|---|---:|---:|---:|---:|---:|---|---|
| Compose readiness | | 10 | | | | | |
| Imposter cold readiness | | 10 | | | | | |
| Imposter warm readiness | | 10 | | | | | |
| IPinfo compile | | 100 | | | | | |
| Forced cleanup | | 10 | | | | | |

## Exit criteria

- Results are attached to the relevant PR or committed under `artifacts/benchmarks/` with prohibited-data scanning.
- At least two parallel runtimes demonstrate isolated state and cleanup.
- Any platform limit discovered by the benchmark is reflected in configuration defaults and documentation.
