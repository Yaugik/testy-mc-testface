# GL-EYE test-environment contract v1

- **Status:** Draft for GL-EYE engineering and security approval
- **Adapter contract:** `TargetAdapter` v1.0
- **Allowed environments:** isolated development, CI, and approved staging only

## 1. Purpose

This contract defines the public or explicitly approved test interfaces that Testy McTestface may use to configure, exercise, observe, and clean GL-EYE test resources. It prohibits coupling to Laravel classes, PostgreSQL tables, Redis, queues, or undocumented internal endpoints.

## 2. Authentication and authorization

GL-EYE must issue short-lived test credentials scoped to one run and environment. Credentials must permit only:

- creating and deleting temporary test tenants and sites;
- configuring run-specific provider endpoints;
- reading processing status and sanitized business outcomes;
- removing resources created by the same run.

Production credentials and production environments are forbidden. Every request must carry the run correlation ID and be auditable without logging credential values.

## 3. Provider endpoint configuration

GL-EYE must expose an approved mechanism to set run-specific IPinfo, Apollo, and Hunter base URLs for temporary test resources. The mechanism must:

- accept only HTTPS or private test-network destinations;
- reject public provider domains and unapproved hosts;
- expire automatically with the run lease;
- prevent one tenant or run from reading another run's configuration;
- expose the effective configuration through a sanitized read-back endpoint.

## 4. Synthetic source IP convention

Traffic must enter through the trusted Testy gateway. GL-EYE must trust the gateway only in approved test environments and only for reserved documentation ranges:

- `192.0.2.0/24`
- `198.51.100.0/24`
- `203.0.113.0/24`

The gateway strips caller-supplied forwarding headers before applying the leased synthetic address. GL-EYE must reject the convention outside approved test environments.

## 5. Provisioning

`prepareRun` must create at least two isolated tenants and the sites required by the scenario. Provisioning responses must return opaque identifiers, expiry times, and no production-derived data.

`configureSyntheticSite` must bind a run-specific synthetic site to the intended tenant and tracking configuration. Hostnames must use `.test`, `.example`, or `.invalid` domains.

## 6. Completion observation

The preferred interface is an authenticated status endpoint or webhook keyed by the run correlation ID. It must expose only:

- current processing state;
- terminal success or failure;
- sanitized error code;
- timestamps;
- correlation identifiers.

UI polling is a fallback and requires explicit approval. Direct queue, cache, or database inspection is prohibited.

## 7. Outcome observation

`collectOutcome` must support external assertions for:

- identified company presence or absence;
- score count and idempotency;
- enrichment completion state;
- provider correlation identifiers;
- tenant visibility for Customer Alpha and Customer Beta;
- suppression or terminal failure outcomes.

Responses must omit raw contacts, full IP addresses, cookies, form contents, credentials, and internal stack traces.

## 8. Cleanup

`cleanupRun` must be idempotent and remove all temporary tenants, sites, credentials, endpoint overrides, webhooks, and other resources created for the run. Cleanup must be safe after partial provisioning, timeout, cancellation, and repeated invocation.

Expired resources must be reaped automatically even if Testy is unavailable.

## 9. Required error semantics

Interfaces must return stable machine-readable error codes for:

- invalid or expired run lease;
- unauthorized environment;
- destination not allowlisted;
- resource ownership mismatch;
- duplicate/idempotent request;
- observation timeout;
- cleanup partially completed.

Errors must be sanitized and must not disclose infrastructure topology, secrets, SQL, Redis keys, queue names, or framework stack traces.

## 10. Approval checklist

Before the complete vertical slice begins, owners must record:

- [ ] test environment names and network boundaries;
- [ ] authentication issuer, scopes, and expiry;
- [ ] provider endpoint configuration API;
- [ ] trusted gateway convention;
- [ ] tenant and site provisioning API;
- [ ] processing status endpoint or webhook;
- [ ] company, score, enrichment, and tenant-visibility outcome API;
- [ ] cleanup API and stale-resource TTL;
- [ ] rate limits and concurrency limits;
- [ ] security and privacy approval;
- [ ] GL-EYE engineering approval.
