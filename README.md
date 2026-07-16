# Testy McTestface

Configuration-driven black-box testing platform for GL-EYE and compatible systems.

This project complements [Yaugik/gl-eye-spec-tacles](https://github.com/Yaugik/gl-eye-spec-tacles).

## Current implementation

The repository now contains the initial TypeScript platform foundation and the
first vendor simulation vertical slice:

- Fastify Control Plane health and readiness endpoints.
- PostgreSQL migration runner and initial `test_runs` model.
- Shared platform identifiers and lifecycle types.
- Vendor v1 JSON Schemas and runtime-neutral execution model.
- YAML package loader with source-aware diagnostics and deterministic hashing.
- Initial synthetic IPinfo package.
- Deterministic Imposter bundle compiler with manifests and source maps.
- Docker-backed Imposter runtime lifecycle with readiness and idempotent cleanup.
- Privacy-safe provider-call ledger and runtime-log redaction.

## Local development

Requirements:

- Node.js 24 or newer.
- pnpm 10 or newer.
- Docker for PostgreSQL-backed development and Imposter runtime smoke tests.

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
- [ADR 0001: Imposter runtime boundary](docs/adr-0001-imposter-runtime.md)
