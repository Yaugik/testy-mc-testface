# Testy McTestface

Configuration-driven black-box testing platform for GL-EYE and compatible systems.

This project complements [Yaugik/gl-eye-spec-tacles](https://github.com/Yaugik/gl-eye-spec-tacles).

## Current implementation

The repository now contains the initial TypeScript platform foundation and the
first versioned vendor-configuration slice:

- Fastify Control Plane health and readiness endpoints.
- PostgreSQL migration runner and initial `test_runs` model.
- Shared platform identifiers and lifecycle types.
- Vendor v1 JSON Schemas and runtime-neutral execution model.
- YAML package loader with source-aware diagnostics and deterministic hashing.
- Initial synthetic IPinfo package.

## Local development

Requirements:

- Node.js 24 or newer.
- pnpm 10 or newer.
- Docker with Compose for PostgreSQL-backed development.

```bash
corepack enable
pnpm install
pnpm build
pnpm test
pnpm vendor:validate
docker compose up --build
```

Control Plane endpoints:

- `GET http://localhost:3000/v1/health`
- `GET http://localhost:3000/v1/readiness`

## Documents

- [Product and System Plan v0.3](Standalone_Testing_Platform_Product_and_System_Plan_v0.3.md)
- [Technical Design v0.3](Standalone_Testing_Platform_Technical_Design_v0.3.md)
- [Implementation Plan v0.1](Standalone_Testing_Platform_Implementation_Plan_v0.1.md)
- [Vendor DSL v1](docs/vendor-dsl-v1.md)
