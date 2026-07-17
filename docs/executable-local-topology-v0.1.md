# Executable local topology v0.1

This topology is the supported pre-GL-EYE conformance environment. It runs the Control Plane, PostgreSQL, Traffic Gateway, Reference SUT, Chromium and run-scoped Imposter vendor containers through Docker Compose.

## Prerequisites

- Docker Engine with Compose v2.
- Access to `/var/run/docker.sock` from the local development environment.
- Permission to create the host directory selected by `TESTY_GENERATED_HOST_ROOT`.
- Ability to pull the configured Node/Playwright, PostgreSQL and Imposter images before the isolated network is started.

The default generated root is `/tmp/testy-generated`. The same absolute path is bind-mounted into the Control Plane because the Control Plane writes bundles while the host Docker daemon mounts those bundles into sibling Imposter containers.

## Topology

All long-running and ephemeral services join the explicit `testy-platform` network:

- `control-plane`
- `traffic-gateway`
- `reference-sut`
- `postgres`
- one Imposter container per configured vendor and active run

The network is marked internal. The host-published ports are for local operator access only:

- Control Plane: `3000`
- Traffic Gateway: `3100`
- Reference SUT: `8080`
- PostgreSQL: `5432`

Vendor runtimes do not publish random host ports in this mode. Their provider endpoints use Docker DNS names such as:

```text
http://testy-<run-id>-ipinfo:8080/ipinfo
```

Both the Control Plane and Reference SUT can resolve those names on `testy-platform`.

## Commands

```bash
pnpm local:up
pnpm local:conformance
pnpm testy status <run-id>
pnpm testy report <run-id>
pnpm local:down
```

`local:conformance` validates and submits `reference-sut-conformance` through the Control Plane. The scenario exercises browser tracking, provider calls, duplicate-event idempotency, tenant isolation, reporting and cleanup.

## Docker socket boundary

The Control Plane has write access to the Docker socket in this local-only topology. Docker socket access is equivalent to host-level control and must not be used for a shared or untrusted deployment.

A production-like topology must replace the socket with a separately authenticated runtime-manager service or another constrained container-control interface.

## Generated storage

Set an explicit host path when `/tmp` is unsuitable:

```bash
export TESTY_GENERATED_HOST_ROOT="$HOME/.local/share/testy/generated"
docker compose up --build -d
```

The selected path must be absolute. It contains compiled vendor bundles and browser artifacts and is subject to the Control Plane retention policy.

## Diagnostics

### Imposter container cannot mount its configuration

Verify that `GENERATED_RUNS_DIR` reported inside the Control Plane begins with the same absolute path used as `TESTY_GENERATED_HOST_ROOT` on the host.

### Imposter runtime never becomes ready

Check that the ephemeral container joined `testy-platform` and that its name matches the endpoint recorded by the Control Plane. The runtime does not expose a host port in Compose mode.

### Chromium cannot start

The platform image is based on the Playwright `v1.59.1-noble` image and includes its browser dependencies. Verify that the package Playwright version and image version remain aligned.

### Reference SUT cannot call providers

Confirm that the runtime endpoints use container DNS names rather than `127.0.0.1`, and that the Reference SUT and ephemeral runtime are attached to `testy-platform`.

## Verification boundary

This branch defines and wires the executable topology but does not claim that Compose, Chromium or Docker were executed in the GitHub connector environment. The first local verification should run the conformance scenario, inspect the final report, verify all ephemeral Imposter containers were removed, and confirm no files appear outside the configured generated root.
