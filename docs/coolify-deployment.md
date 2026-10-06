# Coolify deployment

This deployment runs Testy McTestface against a separate GL-EYE testing target.
It must not target the production GL-EYE runtime.

## Prerequisites

1. Deploy GL-EYE from its `compose.testing.yaml`.
2. Create the shared Docker network once on the Coolify host:

```sh
docker network inspect testy-gl-eye >/dev/null 2>&1 || docker network create testy-gl-eye
```

3. Confirm the GL-EYE testing `app` service is attached to that network with
   the alias `gl-eye-app`.
4. Keep the Testy bearer token identical in both deployments.

## Coolify resource

Create a Git-backed Docker Compose application from
`Yaugik/testy-mc-testface`:

- branch: `main`
- compose file: `/compose.coolify.yaml`
- public service, if required: `control-plane` on internal port `3000`
- do not expose `traffic-gateway` or PostgreSQL publicly

The Compose stack contains a dedicated Testy PostgreSQL database, the Traffic
Gateway, and the Control Plane. The Control Plane mounts the Docker socket
because Testy creates isolated Imposter provider runtimes during scenario
execution.

## Required variables

Use URL-safe random values. Hex output from `openssl rand -hex 32` is suitable.

```env
TESTY_POSTGRES_PASSWORD=<hex-secret>
TESTY_GATEWAY_ADMIN_TOKEN=<hex-secret>
TESTY_MAINTENANCE_ADMIN_TOKEN=<hex-secret>
GL_EYE_TEST_SUPPORT_TOKEN=<same-value-used-by-gl-eye-testing>

TESTY_GL_EYE_NETWORK=testy-gl-eye
TESTY_BROWSER=chromium
TESTY_HEADLESS=true

# Public Control Plane origin used as the suffix for generated demo hosts.
# Example demo: demo-<session>.testy.example.com
TESTY_PUBLIC_DEMO_BASE_URL=https://testy.example.com
```

Interactive Demo sessions derive their browser hostname from
`TESTY_PUBLIC_DEMO_BASE_URL`. For example, with
`https://testy.example.com`, Testy generates
`https://demo-<session>.testy.example.com/` instead of a local-only
`.localhost` URL. Configure the matching wildcard DNS/proxy route
(`*.testy.example.com`) to the Control Plane on port 3000. The variable may
also use `http://` for temporary test-only deployments; GL-EYE still receives
the synthetic site's HTTPS origin.

The Coolify stack sets the container `TESTY_IMPOSTER_IMAGE` from `TESTY_IMPOSTER_RUNTIME_IMAGE`, defaulting to `outofcoffee/imposter:5-beta`. This deliberately avoids stale Coolify variables named `TESTY_IMPOSTER_IMAGE` overriding the runtime image after Compose updates. Use `TESTY_IMPOSTER_RUNTIME_IMAGE` for any deployment-specific image override.

For reproducible provider-runtime execution, set `TESTY_IMPOSTER_RUNTIME_IMAGE` to an
exact `image@sha256:<digest>` after validating the desired Imposter release.

## Security

The Traffic Gateway is an internal service and must not receive a public
domain. The Control Plane stores generated Testy artifacts at the fixed host/container path `/var/lib/testy/generated` so sibling Docker runtimes can mount the same files. The Control Plane contains operational test APIs and should not be
published without an access-control layer. Prefer Coolify proxy authentication
or restricted network access if a browser-accessible domain is added.

## Verification

From inside the Control Plane container, or through its protected domain:

```sh
curl --fail http://localhost:3000/v1/health
curl --fail http://localhost:3000/v1/readiness
curl --fail http://localhost:3000/v1/target-readiness
```

`/v1/target-readiness` must report the GL-EYE target as ready and the
capabilities contract as `v1` before running scenarios.

The deployed integration uses:

- GL-EYE: `http://gl-eye-app:8000`
- Traffic Gateway: `http://traffic-gateway:3100`
- target environment: `testing`
- provider/runtime network: `testy-gl-eye`

The existing local `compose.yaml` and `compose.gl-eye.yaml` remain unchanged
for developer machines.
