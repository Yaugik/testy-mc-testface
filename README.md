# Testy McTestface

Configuration-driven black-box testing platform for GL-EYE and compatible systems.

This project complements [Yaugik/gl-eye-spec-tacles](https://github.com/Yaugik/gl-eye-spec-tacles).

## Current implementation

The repository now contains the TypeScript platform foundation and a reusable
multi-vendor simulation layer:

- Fastify Control Plane health and readiness endpoints.
- PostgreSQL migration runner and initial `test_runs` model.
- Shared platform identifiers and lifecycle types.
- Vendor v1 JSON Schemas and runtime-neutral execution model.
- YAML package loader with source-aware diagnostics and deterministic hashing.
- Synthetic IPinfo, Apollo, and Hunter packages.
- Path, query, header, form, raw-body, and JSON/JsonPath request matching.
- Deterministic Imposter bundle compiler with manifests and source maps.
- Generated Imposter scripts for request counters, system-state transitions,
  ordered response sequences, and namespaced store mutations.
- Docker-backed Imposter runtime lifecycle with readiness and idempotent cleanup.
- Runtime state inspection/reset through the isolated Imposter store API.
- Privacy-safe provider-call ledger and runtime-log redaction.
- Versioned `contract.yaml` suites and a shared Docker contract runner.

## Local development

Requirements:

- Node.js 24 or newer.
- pnpm 10 or newer.
- Docker for PostgreSQL-backed development and Imposter runtime tests.

```bash
corepack enable
pnpm install
pnpm build
pnpm test
pnpm vendor:validate
pnpm vendor:compile
```

Start PostgreSQL and the Control Plane:

```bash
docker compose up --build
```

Start a compiled IPinfo Imposter runtime and keep it active until `Ctrl+C`:

```bash
pnpm vendor:runtime
```

Run the focused stateful IPinfo capability smoke test:

```bash
pnpm vendor:smoke
```

Run every declarative vendor contract suite:

```bash
pnpm vendor:contracts
```

The contract command validates, compiles, starts, exercises, and removes one
isolated Imposter runtime for each vendor. It verifies HTTP and transport
outcomes, matched cases, sequence positions, state transitions, and logical
store values. Each suite prints a JSON report and exits non-zero on failure.

For release-oriented runtime testing, set `TESTY_IMPOSTER_IMAGE` to an exact
`image@sha256:<digest>` reference. The development default uses the Imposter 5
major tag and emits a compiler warning until a digest is supplied.

Control Plane endpoints:

- `GET http://localhost:3000/v1/health`
- `GET http://localhost:3000/v1/readiness`

## Documents

- [Product and System Plan v0.3](Standalone_Testing_Platform_Product_and_System_Plan_v0.3.md)
- [Technical Design v0.3](Standalone_Testing_Platform_Technical_Design_v0.3.md)
- [Implementation Plan v0.1](Standalone_Testing_Platform_Implementation_Plan_v0.1.md)
- [Vendor DSL v1](docs/vendor-dsl-v1.md)
- [Imposter compiler and runtime v0.1](docs/imposter-runtime-v0.1.md)
- [Stateful Imposter runtime v0.2](docs/imposter-stateful-runtime-v0.2.md)
- [Vendor contract suites v0.1](docs/vendor-contract-suites-v0.1.md)
- [ADR 0001: Imposter runtime boundary](docs/adr-0001-imposter-runtime.md)
