# Imposter compiler and runtime v0.1

This slice turns a validated `VendorExecutionModel` into a self-contained Imposter
bundle and provides an isolated Docker lifecycle for running that bundle.

## Official runtime contract used

The implementation follows Imposter's documented REST configuration model:

- configuration files use the `-config.json` suffix;
- REST resources support method, path, path-parameter, query-parameter, form,
  header and raw-body matching;
- native security policies deny by default and permit configured header or query
  values;
- exact response delays are expressed in milliseconds;
- `CloseConnection` is the documented connection failure primitive;
- Docker configuration is mounted at `/opt/imposter/config`;
- readiness is observed through `GET /system/status`.

References:

- <https://docs.imposter.sh/configuration/>
- <https://docs.imposter.sh/request_matching/>
- <https://docs.imposter.sh/security/>
- <https://docs.imposter.sh/performance_simulation/>
- <https://docs.imposter.sh/failure_simulation/>
- <https://docs.imposter.sh/run_imposter_docker/>
- <https://docs.imposter.sh/metrics_logs_telemetry/>

## Generated bundle

```text
generated/vendors/<bundle-id>/
├── manifest.json
├── source-map.json
└── imposter/
    ├── vendor-config.json
    └── responses/
```

The compiler is deterministic for the same source package, compiler version,
runtime image and optional run namespace. The manifest records source and output
hashes, compiler capabilities and known warnings. The source map links every
Imposter resource back to the vendor operation or routing rule that generated it.

## Supported compiler primitives

- Native Imposter REST resources.
- Header and query authentication through a deny-by-default security policy.
- Exact matches for path, query, header and form fields.
- `EqualTo`, `NotEqualTo`, `Exists`, `NotExists`, `Contains` and `Matches`
  operators.
- Raw-body matching.
- Status codes, response headers, response files and exact delays.
- Connection-close failures.
- Timeout approximation using an exact delay followed by `CloseConnection`.
- Privacy-safe static match markers containing vendor, operation, case and a
  synthetic correlation identifier.

Unsupported matchers or transport primitives fail compilation instead of silently
changing semantics.

## Runtime lifecycle

`ImposterRuntimeManager`:

1. starts one Docker container for one written bundle;
2. mounts the generated configuration read-only;
3. binds Imposter to a dynamically allocated localhost port;
4. disables request and response body logging;
5. exposes only the synthetic correlation header in structured summaries;
6. polls `/system/status` until ready;
7. cleans up the container if startup fails;
8. provides idempotent shutdown;
9. converts logs into a privacy-safe provider ledger.

Full request paths are not retained in the ledger. They are represented by a
SHA-256 fingerprint. Runtime logs exposed to callers redact query strings,
credentials, email addresses and IP addresses.

## Runtime image policy

The development default is currently `outofcoffee/imposter:5`. This is suitable
for the capability slice but is intentionally reported as a manifest warning.
Before release gating, `TESTY_IMPOSTER_IMAGE` must be set to an exact
`image@sha256:<digest>` reference verified by the local Docker smoke suite.

## Deferred capability work

- State transitions and counters.
- Ordered response sequences.
- Store mutation and retrieval.
- A distinct connection-reset primitive.
- OpenAPI-backed request validation.
- Multi-request concurrency verification against a real Imposter container.
- Final image digest and licensing ADR approval.
