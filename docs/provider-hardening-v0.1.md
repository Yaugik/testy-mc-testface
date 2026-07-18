# Provider hardening v0.1

This slice closes the remaining provider-foundation gaps before browser work.
It adds prohibited-data validation, richer ledger assertions, and explicit
parallel runtime-isolation probes for IPinfo, Apollo, and Hunter.

## Fixture privacy gate

`@testy/privacy-validation` scans JSON and YAML files before a vendor package is
compiled or started. It rejects:

- IP addresses outside RFC 5737 documentation ranges and localhost;
- domains outside `.example`, `.test`, and `.invalid`;
- email addresses using non-synthetic domains;
- private key material;
- common live credential formats;
- sensitive fields whose values are not visibly synthetic.

Issues contain only source location, rule, and a short SHA-256 fingerprint. The
scanner never reproduces a suspicious credential in its report.

Run all package scans with:

```bash
pnpm privacy:vendors
```

Vendor contract and isolation CLIs invoke the same gate automatically before
loading, compilation, or container startup.

## Provider-call assertions

A contract case can now declare `expect.calls`:

```yaml
expect:
  calls:
    total:
      exact: 3
    byCase:
      complete-company:
        min: 1
    orderedCases:
      - complete-company
      - partial-company
      - no-result
    absentCases:
      - quota-exhausted
    durationMs:
      min: 0
      max: 5000
    retryIntervalMs:
      min: 0
      max: 5000
```

Count expectations support `exact` or inclusive `min`/`max` bounds. Timing is
read from the sanitized provider ledger rather than raw request payloads.
Authentication tests use an exact zero-call expectation to prove that rejected
credentials never reach a vendor case.

Step expectations can also use `durationMs` when a single correlated call needs
a provider-side latency bound.

## Parallel isolation probes

Each vendor contract includes an optional top-level `isolation` definition. The
isolation CLI:

1. compiles the same package twice with different run namespaces;
2. starts two Imposter containers bound to separate localhost ports;
3. confirms their generated physical store names are disjoint;
4. mutates only the left runtime;
5. verifies the expected left state and store values;
6. verifies the right runtime remains at its initial state with absent keys;
7. confirms the right ledger never observes the left correlation;
8. resets and removes both runtimes.

Run every probe with:

```bash
pnpm vendor:isolations
```

## Verification boundary

Unit tests cover scanner decisions, count/order/timing assertions, zero-call
checks, and two-runtime isolation using deterministic fake runtimes. Contract
schemas and all three vendor contracts are validated against Draft 2020-12.

A real Docker run remains environment-dependent. Release gating must execute
`pnpm privacy:vendors`, `pnpm vendor:contracts`, and `pnpm vendor:isolations`
with a digest-pinned Imposter image.
