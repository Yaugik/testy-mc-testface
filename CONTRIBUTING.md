# Contributing

## Prerequisites

- Node.js 24
- pnpm 10
- Docker with Docker Compose

## Local setup

```bash
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --no-frozen-lockfile
cp .env.example .env
```

Run the repository checks:

```bash
pnpm ci
```

Start PostgreSQL and the Control Plane:

```bash
docker compose up --build
```

The service exposes:

- `GET http://localhost:3000/v1/health`
- `GET http://localhost:3000/v1/readiness`

## Development conventions

- Use strict TypeScript.
- Keep platform packages independent from GL-EYE implementation code.
- Do not log credentials, cookies, contact payloads, form values, or full IP addresses.
- Add tests for every new public behavior.
- Add an ADR for decisions that change platform boundaries or introduce a runtime primitive.
