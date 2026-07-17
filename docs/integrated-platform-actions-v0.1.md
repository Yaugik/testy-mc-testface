# Integrated platform actions and Customer Alpha vertical slice v0.1

This slice connects the previously independent vendor, browser, gateway, target, evidence, assertion, and reporting components behind the scenario action registry.

## Run-scoped action state

`@testy/platform-actions` owns in-memory state only for the lifetime of one scenario run. The state contains compiled vendor bundles, active Imposter runtimes, the loaded browser package, the synthetic site binding, and browser reports. It is keyed by run ID and removed during scenario cleanup.

Registered actions:

```text
vendor.compile
vendor.start-runtime
vendor.collect-ledger
vendor.collect-state
browser.load-package
site.start
browser.run-journey
browser.collect-site-events
platform.configure-target-vendors
platform.configure-target-site
```

Package paths are resolved below configured vendor and customer roots. Absolute paths, parent traversal, backslashes, and unsafe path segments are rejected.

## Dynamic target configuration

The scenario does not hard-code generated Imposter ports or the run-specific synthetic hostname. After vendor runtimes and the site are active:

- `platform.configure-target-vendors` reads the current run's provider base URLs and delegates to `target.configure-vendors`;
- `platform.configure-target-site` reads the generated site ID and hostname and delegates to `target.configure-site`.

The delegates are registered only when the complete gateway and GL-EYE test-support configuration is present. Without that configuration, deterministic vendor and browser actions remain available, while the two target bridge actions fail explicitly.

## Evidence and artifacts

Vendor ledger collection writes deduplicated provider-call records. Runtime-state collection writes sanitized observations. Browser execution writes one browser-action record per journey action, a journey summary observation, and artifact records for the report, screenshots, trace, and selected HAR. Synthetic-site collection stores event counts, field names, and body fingerprints without retaining submitted values.

Vendor manifest and source-map files are also registered as artifacts with SHA-256 hashes. Runtime and site cleanup are registered as resource leases. Restart cleanup removes persisted vendor containers by container ID; a synthetic site needs no restart action because the owning process no longer exists.

## Complete scenario

`scenarios/customer-alpha-vertical.yaml` performs:

1. gateway-route allocation and target preparation;
2. parallel compilation and startup of IPinfo, Apollo, and Hunter;
3. Customer Alpha package loading and site startup;
4. dynamic target vendor/site configuration;
5. target observation startup;
6. the `lead-capture` Playwright journey;
7. browser, site, provider, runtime, target, and gateway evidence collection;
8. declarative assertions and durable JSON/HTML reporting;
9. reverse cleanup of site, runtimes, gateway route, and target run.

## Configuration

```text
VENDOR_PACKAGES_DIR=vendors
BROWSER_PACKAGES_DIR=customers
GENERATED_RUNS_DIR=generated/runs
TESTY_BROWSER=chromium
TESTY_HEADLESS=true
TESTY_IMPOSTER_IMAGE=outofcoffee/imposter:5
```

The full vertical scenario also requires the complete gateway and GL-EYE integration variables documented in `traffic-gateway-gl-eye-adapter-v0.1.md`.

## Commands

```bash
pnpm platform:test
pnpm vertical:validate
pnpm vertical:run
```

`vertical:run` submits the catalog scenario through the CLI and therefore requires a running Control Plane, PostgreSQL, Traffic Gateway, Docker-capable vendor runtime environment, installed Playwright browser, and a GL-EYE test-support deployment.

## Verification boundary

Strict TypeScript verification and a dependency-injected action-registry test cover path confinement, dynamic endpoint/site delegation, persisted provider and browser evidence, artifact hashing, resource leases, and reverse cleanup. The scenario YAML was parsed and its action/ assertion structure reviewed against the current schema.

A real Docker, Chromium, PostgreSQL, Traffic Gateway, and GL-EYE execution remains the release verification step. CI and GitHub Actions are not part of this workflow.
