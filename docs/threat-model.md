# Initial threat model

## Scope

This model covers the standalone Testy platform, its Docker Compose network, PostgreSQL, generated vendor bundles, Imposter runtimes, browser workers, traffic gateway, GL-EYE test adapter, reports, and artifacts.

## Trust boundaries

1. Developer or CI user to the Control Plane.
2. Control Plane to worker and runtime services.
3. Testy private network to the GL-EYE test environment.
4. Traffic Gateway to approved GL-EYE hosts.
5. Generated configuration and fixtures to Imposter.
6. Runtime records to reports and artifacts.

## Assets

- short-lived test credentials;
- run and tenant isolation state;
- provider endpoint overrides;
- synthetic visitor identity and source IP leases;
- sanitized call ledgers and target outcomes;
- browser traces, screenshots, and selected network metadata;
- runtime and artifact integrity hashes.

## Primary threats and controls

| Threat | Required controls |
|---|---|
| Gateway used as a general IP-spoofing proxy | Test-environment-only deployment, authenticated run routes, documentation-range IP leases, destination allowlist, stripped forwarding headers, automatic expiry. |
| Unexpected internet egress reaches real providers | Private network, explicit destination allowlists, deny-by-default egress, fail the run on unexpected destinations. |
| Cross-run or cross-tenant state leakage | Per-run runtime, unique namespaces, browser context isolation, resource leases, ownership checks, parallel isolation tests. |
| Credentials or personal data leak into logs/reports | Allowlist capture, centralized redaction, fingerprints instead of bodies, fixture scanning, prohibited-data tests, short retention. |
| Malicious or overly powerful YAML executes code | Versioned schemas, no arbitrary JavaScript, bounded typed primitives, reviewed generated scripts only, source mapping. |
| Generated bundle or fixture tampering | Deterministic hashes, read-only runtime mounts, source maps, manifest verification. |
| Stale resources survive failures | Idempotent cleanup, forced runtime removal, lease expiry, periodic reaper, process-kill tests. |
| Test adapter exposes internal GL-EYE implementation | Public/approved test APIs only; no database, Redis, queue, or framework imports. |
| SSRF through provider endpoint configuration | Scheme and host validation, private/loopback runtime addresses only, GL-EYE-side allowlist, no redirects to unapproved hosts. |
| Artifact access exposes another run | Run-scoped authorization, opaque identifiers, ownership checks, short-lived signed access where needed. |
| Dependency or container compromise | Pinned versions and digests, SBOM and vulnerability scan, minimal images, read-only filesystems where practical. |

## Security invariants

- Production environments and credentials are never accepted.
- Fixtures use only synthetic identities, documentation IP ranges, and reserved domains.
- One run cannot address another run's runtime, target resources, browser state, or artifacts.
- Sensitive values are rejected or redacted before persistence.
- Cleanup is safe to repeat and runs on every terminal path.
- Unknown egress is a test failure, not merely a warning.

## Validation backlog

- gateway header-stripping and route-expiry tests;
- SSRF and redirect tests;
- concurrent runtime and tenant isolation tests;
- fixture secret/PII scanning;
- process-kill and stale-resource reaping tests;
- report prohibited-data mutation tests;
- container image digest, SBOM, and vulnerability verification.
