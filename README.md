# Testy McTestface

Planning, technical design, and implementation of the Standalone Testing Platform.

This project complements [Yaugik/gl-eye-spec-tacles](https://github.com/Yaugik/gl-eye-spec-tacles).

## Documents

- [Product and System Plan v0.3](Standalone_Testing_Platform_Product_and_System_Plan_v0.3.md)
- [Technical Design v0.3](Standalone_Testing_Platform_Technical_Design_v0.3.md)
- [Implementation Plan v0.1](Standalone_Testing_Platform_Implementation_Plan_v0.1.md)

## Development

The first development slice provides:

- A pnpm TypeScript workspace.
- Shared platform types.
- A Fastify Control Plane with liveness and PostgreSQL readiness endpoints.
- Checksum-protected PostgreSQL migrations and the initial `test_runs` table.
- Docker Compose startup for PostgreSQL and the Control Plane.
- Unit, type, formatting, lint, Docker build, and secret-scan CI checks.

### Start locally

```bash
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --no-frozen-lockfile
docker compose up --build
```

Then check:

```bash
curl http://localhost:3000/v1/health
curl http://localhost:3000/v1/readiness
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development conventions.
