# Standalone Testing Platform

> **Implementation Plan v0.1 — 16 July 2026**

| Field | Value |
|---|---|
| Status | Draft for engineering review |
| Product | Testy McTestface |
| System under test | GL-EYE B2B Visitor Intelligence SaaS MVP |
| Delivery model | Independent black-box testing platform |
| Related documents | `Standalone_Testing_Platform_Product_and_System_Plan_v0.3.md`, `Standalone_Testing_Platform_Technical_Design_v0.3.md` |

## 1. Objective

Build a standalone, configuration-driven black-box testing platform for GL-EYE and future compatible systems.

The platform will:

- Run synthetic browser journeys and direct HTTP traffic.
- Simulate IPinfo, Apollo, and Hunter without live credentials.
- Exercise identification, enrichment, consent, retries, idempotency, privacy controls, failure handling, and tenant isolation.
- Observe the system under test only through public or approved test-environment interfaces.
- Produce deterministic JSON and HTML reports with sanitized timelines and debugging artifacts.
- Allow supported vendor cases, customers, websites, personas, journeys, and scenarios to be added through configuration rather than platform code.

The platform must remain independent of GL-EYE's Laravel code, PostgreSQL database, Redis queues, and internal implementation details.

## 2. Recommended delivery model

### 2.1 Suggested team

- Two platform/backend engineers.
- One QA automation engineer or SDET.
- A part-time GL-EYE application engineer for target-adapter work.
- Part-time DevOps and security support.
- A product or engineering owner for scope and acceptance decisions.

### 2.2 Indicative schedule

The proposed MVP schedule is **12 weeks** with the team above.

A two-person team can deliver the same scope, but a more realistic schedule would be approximately 16–20 weeks.

### 2.3 Delivery principles

1. Build one complete vertical slice before expanding scenario coverage.
2. Treat the YAML models as versioned product APIs.
3. Keep Imposter and Playwright behind internal platform abstractions.
4. Require deterministic behavior and run-level isolation from the beginning.
5. Build privacy and egress controls into the foundation rather than adding them during final hardening.
6. Do not implement arbitrary JavaScript escape hatches in scenario or journey YAML.
7. Add platform code only for genuinely new runtime primitives.
8. Prefer externally observable contracts over implementation-specific test hooks.

## 3. Proposed technical baseline

The following choices are recommended where the existing design is not prescriptive:

- **Language:** TypeScript.
- **Runtime:** Pinned Node.js LTS release.
- **Monorepo:** pnpm workspaces with Turborepo or Nx.
- **Control Plane API:** Fastify or NestJS.
- **Database:** PostgreSQL.
- **Schema validation:** JSON Schema with Ajv.
- **Configuration parsing:** YAML parser with source-location preservation.
- **Browser runtime:** Playwright.
- **Provider simulation runtime:** Pinned Imposter container image.
- **Container orchestration:** Docker Compose for the MVP.
- **Testing:** Vitest or Jest, Playwright Test, and container-based integration tests.
- **Reporting:** Static HTML generated from a canonical JSON run report.
- **Artifacts:** Local filesystem in development with an S3-compatible adapter for CI environments.

### 3.1 Initial repository structure

```text
testy-mc-testface/
├── apps/
│   ├── control-plane/
│   ├── browser-worker/
│   ├── vendor-runtime-manager/
│   ├── synthetic-site-host/
│   ├── traffic-gateway/
│   ├── traffic-generator/
│   └── cli/
├── packages/
│   ├── shared-types/
│   ├── config-loader/
│   ├── scenario-schema/
│   ├── scenario-engine/
│   ├── vendor-schema/
│   ├── vendor-compiler/
│   ├── browser-schema/
│   ├── browser-runner/
│   ├── assertion-engine/
│   ├── privacy-validation/
│   └── reporting/
├── vendors/
├── customers/
├── scenarios/
├── adapters/
│   └── gl-eye/
├── reference-sut/
├── infrastructure/
│   ├── compose/
│   └── ci/
└── docs/
```

## 4. Implementation phases

## Phase 0 — Architecture contracts and technical spikes

**Duration:** Week 1

### Goals

Resolve technical decisions that could invalidate later work.

### 0.1 Imposter capability spike

Create automated experiments for:

- Header, path, query, cookie, and JSON-body matching.
- Authentication success and failure.
- Shared stores and counters.
- Ordered response sequences.
- Fixed and bounded delays.
- Timeouts.
- Connection close or reset behavior.
- Request capture.
- State transitions.
- Multiple provider base paths in one runtime.
- Runtime readiness and shutdown.
- Docker and CI execution.

The output must be an automated compatibility suite rather than a manual proof of concept.

### 0.2 Select and pin the runtime

Record:

- Imposter implementation and version.
- Container image digest.
- Supported and unsupported fault primitives.
- Licensing and distribution decision.
- Startup and shutdown characteristics.
- Maximum tested configuration size.

### 0.3 Define the GL-EYE test contract

Agree with the GL-EYE team on:

- How provider base URLs are injected.
- How the trusted test gateway supplies a synthetic source IP.
- How test tenants and sites are provisioned.
- How test authentication is obtained.
- How asynchronous processing completion is observed.
- Which external endpoints expose company state, scoring, enrichment, and tenant visibility.
- How temporary resources are removed.
- Which test-only capabilities are allowed in each environment.

This contract is a blocking dependency and must be finalized before building the complete vertical slice.

### Deliverables

- Architecture Decision Records.
- Imposter compatibility test suite.
- Pinned runtime and image decision.
- `TargetAdapter` interface v1.
- GL-EYE test-environment contract.
- Initial threat model.
- Initial startup and concurrency benchmark.

### Exit criteria

- Every MVP vendor primitive is demonstrated or explicitly removed.
- A sample Imposter runtime starts and stops in CI.
- The GL-EYE team approves the adapter and observation contract.
- No later phase depends on an undefined way to observe target completion.

---

## Phase 1 — Repository and platform foundation

**Duration:** Week 2

### Goals

Create a production-quality development foundation before implementing domain features.

### Work

- Initialize the TypeScript monorepo and workspace boundaries.
- Add formatting, linting, strict TypeScript, unit testing, and build caching.
- Define package, configuration, and schema versioning conventions.
- Create the Docker Compose development environment.
- Start PostgreSQL and database migrations.
- Define shared identifiers and result types.
- Add structured logging with mandatory redaction.
- Add CI workflows for:
  - Build.
  - Type checking.
  - Linting.
  - Unit tests.
  - Schema validation.
  - Secret scanning.
  - Synthetic-data scanning.
  - Container builds.
- Establish artifact and fixture directory conventions.
- Add contributor documentation and ADR templates.

### Core shared types

Implement foundational types for:

- `RunId`.
- `ScenarioId`.
- `VendorId`.
- `JourneyId`.
- `RunContext`.
- `ResourceLease`.
- `TimelineEvent`.
- `ArtifactReference`.
- `SanitizedError`.
- `Result<T, E>`.

### Exit criteria

- A clean checkout starts through Docker Compose.
- CI runs all foundation checks.
- Schema and package versioning rules are documented.
- Logs reject or redact authorization headers, cookies, contact data, and raw IPs.

---

## Phase 2 — Vendor DSL and compiler foundation

**Duration:** Weeks 3–4

### Goals

Implement the vendor authoring model and generate isolated Imposter bundles.

### 2.1 Versioned schemas

Create JSON Schemas for:

- `vendor.yaml`.
- `system-cases.yaml`.
- API operation files.
- Response definitions.
- Scenario-level vendor selection.
- Faults.
- Sequences.
- State transitions.
- Capture and redaction policies.

### 2.2 Configuration loader

The loader must:

- Parse YAML while retaining file and line locations.
- Resolve references and fragments.
- Reject duplicate identifiers.
- Detect reference cycles.
- Normalize durations and matching expressions.
- Produce clear author-facing validation errors.
- Calculate deterministic content hashes.

### 2.3 Runtime-neutral execution model

Create typed intermediate structures such as:

```typescript
interface VendorExecutionModel {
  vendor: VendorMetadata;
  authentication: AuthenticationRule[];
  operations: OperationModel[];
  systemStates: SystemStateModel[];
  transitions: StateTransition[];
  capturePolicy: CapturePolicy;
}
```

The compiler pipeline must:

1. Load the vendor package and scenario selection.
2. Validate YAML against versioned JSON Schemas.
3. Resolve references, fragments, and response assets.
4. Apply privacy and synthetic-data validation.
5. Build a typed runtime-neutral execution model.
6. Apply run namespaces, synthetic credentials, and scenario overrides.
7. Compile the model into Imposter configuration and assets.
8. Produce content hashes and a source map.
9. Start the runtime and verify readiness.
10. Seed stores and expose run-specific provider base URLs.

### 2.4 Imposter compiler output

Generate:

```text
generated/run_<id>/vendors/
├── manifest.json
├── imposter/
│   ├── vendor-config.yaml
│   ├── generated-steps.js
│   ├── responses/
│   └── seeded-store.json
└── source-map.json
```

Generated scripts are allowed only when native configuration cannot represent an approved DSL primitive.

### 2.5 Runtime manager

Implement:

- Create runtime.
- Wait for readiness.
- Seed state.
- Return provider base URLs.
- Collect the privacy-safe call ledger.
- Stop runtime.
- Force cleanup after failure.

### Tests

- Golden-file compiler tests.
- Invalid-schema tests.
- Reference-resolution tests.
- Runtime contract tests for every matching primitive.
- Runtime contract tests for every response and fault primitive.
- Deterministic compilation tests.
- Source-map snapshot tests.

### Exit criteria

- A YAML-defined sample vendor compiles and runs.
- Every generated rule can be traced to its source DSL file and case.
- Identical inputs produce identical bundle hashes.
- A failed compile never starts a runtime.
- Runtime cleanup succeeds after startup, execution, and forced failure.

---

## Phase 3 — IPinfo package and provider assertions

**Duration:** Week 5

### Goals

Implement the first real provider and establish the pattern for future provider packages.

### Required cases

- High-confidence corporate IP.
- Residential IP.
- VPN or proxy.
- Hosting or data-centre IP.
- Unknown IP.
- Low-confidence result.
- Conflicting company attribution.
- Invalid request.
- Invalid authentication.
- Empty response.
- Malformed payload.
- Rate limit.
- Timeout.
- Transient server failure.
- Permanent failure.
- Timeout followed by recovery.
- Failure followed by a successful retry.

### Provider call ledger

Record only:

- Run ID.
- Provider and operation.
- Matched case.
- Attempt number.
- Sanitized request fingerprint.
- Response status.
- Timing.
- State before and after.
- Correlation identifiers.

Do not retain raw credentials, cookies, full raw IPs, form contents, or contact payloads.

### Initial provider assertions

- Call count.
- Matched operation and case.
- Call ordering.
- Attempt count.
- Delay range.
- Retry interval range.
- No call occurred.
- Eventually called.
- Terminal failure occurred.
- Recovery occurred.

### Exit criteria

- All IPinfo cases run deterministically.
- Provider-ledger assertions work independently of GL-EYE.
- The same suite passes locally and in CI.
- Parallel runs cannot see each other's counters, calls, or state.

---

## Phase 4 — Apollo and Hunter packages

**Duration:** Week 6

### Goals

Add enrichment-provider coverage without unnecessarily extending the platform.

### Apollo cases

- Complete company match.
- Partial company match.
- No result.
- Multiple or conflicting matches.
- Suppressed result.
- Invalid payload.
- Authentication failure.
- Quota exhausted.
- Retryable failure.
- Permanent failure.
- Recovery sequence.

### Hunter cases

- Contacts found.
- No contacts.
- Partial contact result.
- Invalid or unverified contact.
- Suppressed domain.
- Quota exhausted.
- Authentication failure.
- Timeout and recovery.
- Conflicting result.

### Rule

A new Apollo or Hunter case should require only YAML and response fixtures. Platform code changes are acceptable only when a genuinely new shared runtime primitive is approved.

### Exit criteria

- Apollo and Hunter packages pass the same contract suite used by IPinfo.
- Package validation catches unsafe domains, real contact details, and credentials.
- Quota, retry, suppression, conflict, and recovery scenarios are deterministic.

---

## Phase 5 — Browser DSL and synthetic customer websites

**Duration:** Weeks 7–8

### Goals

Allow mock websites and normal Playwright journeys to be authored without Playwright code.

### 5.1 Browser schemas

Define schemas for:

- Customer.
- Site.
- Page.
- Element.
- Persona.
- Journey.
- Fragment.
- Browser settings.
- Network fixture.
- Session state.
- Artifact policy.

### 5.2 Synthetic site host

Implement a deterministic site host supporting:

- Run-specific hostnames.
- Static page templates.
- Tracking-script injection.
- Stable `data-test` selectors.
- Consent banner states.
- Forms.
- Navigation.
- Runtime variables.
- Optional controlled response delays or errors.

Visual fidelity is secondary to deterministic behavior and stable selectors.

### 5.3 Playwright action interpreter

Initial action set:

- Navigation: `open`, `navigate`, `reload`, `goBack`, and `goForward`.
- Interaction: `click`, `doubleClick`, `hover`, `fill`, `fillForm`, `select`, `check`, `uncheck`, and `submit`.
- Waiting: `wait`, `waitForRequest`, `waitForResponse`, and `waitForEvent`.
- Assertions: `expectVisible`, `expectHidden`, `expectText`, `expectUrl`, `expectAttribute`, and `expectRequest`.
- State: cookie, local-storage, tab, and session operations.
- Artifacts: screenshots, traces, console errors, failed requests, and selected HAR data.

### 5.4 Selector policy

Enforce this order:

1. Stable `data-test` attribute.
2. Accessible role and name.
3. Label or placeholder.
4. Explicitly approved CSS fallback.

Reject positional selectors such as `nth-child` by default.

### 5.5 Isolation

Each journey gets:

- A separate browser context.
- Separate storage state.
- A separate synthetic network fixture.
- A separate artifact namespace.
- Run-specific hostnames and variables.

### Tests

- Contract test for every action.
- Selector validation tests.
- Fragment expansion tests.
- Variable substitution tests.
- Timeout and cancellation tests.
- Artifact-on-failure tests.
- Multiple-tab tests.
- Returning-session tests.
- Parallel-browser isolation tests.

### Exit criteria

- A new customer site and journey can be added entirely through YAML.
- Journey files contain no JavaScript.
- Failure reports identify the journey, step, page element, and artifact.
- Parallel personas cannot share cookies or local storage.

---

## Phase 6 — Scenario engine, lifecycle, and persistence

**Duration:** Week 9

### Goals

Connect vendor behavior, browser journeys, target resources, observations, and assertions into a reliable run lifecycle.

### Run state machine

```text
CREATED
  -> VALIDATING
  -> ALLOCATING
  -> COMPILING
  -> CONFIGURING
  -> RUNNING
  -> OBSERVING
  -> ASSERTING
  -> PASSED | FAILED

Any active state may transition:
  -> CANCELLING
  -> CANCELLED

Every terminal path:
  -> CLEANUP
```

Cleanup must be idempotent.

### Scenario-engine primitives

Implement:

- Ordered steps.
- Parallel groups.
- Repetition.
- Conditions.
- Poll-until and eventual steps.
- Explicit timeouts.
- Retry policies.
- Cancellation.
- Compensation and cleanup.
- Reusable scenario fragments.
- Resolved-scenario materialization and hashing.

### PostgreSQL entities

Implement:

- `test_runs`.
- `run_steps`.
- `resource_leases`.
- `runtime_instances`.
- `provider_calls`.
- `browser_actions`.
- `observations`.
- `assertion_results`.
- `artifacts`.

### Control Plane APIs

```text
POST /v1/runs
GET  /v1/runs/:runId
POST /v1/runs/:runId/cancel
GET  /v1/runs/:runId/timeline
GET  /v1/runs/:runId/report
GET  /v1/runs/:runId/artifacts

GET  /v1/scenarios
GET  /v1/scenarios/:scenarioId
POST /v1/scenarios/validate

GET  /v1/vendors
POST /v1/vendors/validate
POST /v1/vendors/compile-preview

GET  /v1/customers
POST /v1/customers/validate
POST /v1/journeys/validate

GET /v1/health
GET /v1/readiness
```

### CLI

```text
testy validate
testy validate scenario <id>
testy vendor compile <vendor>
testy run <scenario>
testy run <scenario> --target local
testy status <run-id>
testy report <run-id>
testy cancel <run-id>
testy doctor
```

### Exit criteria

- Run status survives a Control Plane restart.
- Cancellation cleans all allocated resources.
- Cleanup is safe to repeat.
- A run report can be regenerated from persisted sanitized records.
- A fully resolved scenario and its content hash are stored before execution.

---

## Phase 7 — Traffic Gateway and GL-EYE target adapter

**Duration:** Week 10

### Goals

Connect the generic platform to GL-EYE without introducing internal implementation coupling.

### Traffic Gateway work

- Create run-scoped routes.
- Allow only approved GL-EYE target hosts.
- Strip supplied `Forwarded`, `X-Forwarded-For`, and equivalent headers.
- Apply the leased synthetic IP using the agreed test-proxy convention.
- Strip internal testing headers before forwarding where required.
- Record safe metadata and body fingerprints.
- Reject expired or mismatched routes.
- Block real provider destinations and unexpected internet egress.

Synthetic visitor addresses must be limited to documentation ranges:

- `192.0.2.0/24`.
- `198.51.100.0/24`.
- `203.0.113.0/24`.

### GL-EYE adapter contract

```typescript
interface TargetAdapter {
  prepareRun(context: RunContext): Promise<PreparedTarget>;
  configureVendorEndpoints(
    context: RunContext,
    endpoints: VendorEndpoints
  ): Promise<void>;
  configureSyntheticSite(
    context: RunContext,
    site: SiteDefinition
  ): Promise<SiteBinding>;
  startObservation(
    context: RunContext
  ): Promise<ObservationHandle>;
  waitForCompletion(
    context: RunContext,
    condition: CompletionCondition
  ): Promise<ObservationResult>;
  collectOutcome(
    context: RunContext
  ): Promise<TargetOutcome>;
  cleanupRun(context: RunContext): Promise<void>;
}
```

### Adapter implementation rules

- No direct database access.
- No Redis or queue inspection.
- No Laravel class imports.
- No undocumented endpoint use.
- Every test-only interface must be authenticated and restricted to approved test environments.
- Observation should prefer a status API or webhook over UI polling.
- UI polling is a fallback rather than the default integration.

### Exit criteria

- The gateway cannot be used to spoof source IPs outside an isolated test environment.
- GL-EYE receives the intended reserved synthetic source IP.
- Vendor requests from GL-EYE reach the run-specific Imposter runtime.
- The adapter can provision, observe, and clean two isolated tenants.
- An unexpected outbound call causes the run to fail.

---

## Phase 8 — Complete vertical slice

**Duration:** Week 11

### Scenario

A synthetic corporate visitor from **Nordlicht Example GmbH** visits Customer Alpha's website:

1. The platform validates and resolves the scenario.
2. IPinfo, Apollo, and Hunter configurations are compiled.
3. An isolated Imposter runtime starts.
4. A corporate synthetic IP is leased.
5. Customer Alpha and Customer Beta are prepared.
6. The visitor browses three pages and submits an interaction.
7. GL-EYE resolves the visitor to a company.
8. Apollo supplies partial enrichment.
9. Hunter supplies the missing synthetic contact.
10. GL-EYE creates the score once.
11. The result is visible only to Customer Alpha.
12. Reports are generated and all resources are removed.

### Mandatory assertions

- The browser journey passed.
- The expected tracking request was emitted.
- IPinfo was called exactly once for the expected synthetic lookup.
- Apollo and Hunter were called according to enrichment policy.
- The company became visible to Customer Alpha.
- The company was not visible to Customer Beta.
- The score was created exactly once.
- Duplicate input did not duplicate the company or score.
- No unexpected external request occurred.
- No sensitive value appeared in logs, ledgers, or reports.
- Every fixture passed synthetic-data validation.
- All run resources were cleaned.

### Exit criteria

- The scenario passes repeatedly on a clean local environment.
- It passes in CI without production credentials.
- Ten consecutive executions produce equivalent business results.
- At least two runs execute concurrently with no state leakage.
- Deliberately breaking tenant filtering makes the isolation assertion fail.
- Deliberately breaking idempotency makes the score-count assertion fail.

---

## Phase 9 — Hardening and readiness gate

**Duration:** Week 12

### Goals

Turn the working vertical slice into an operable MVP.

### CI levels

1. Static validation: types, linting, schemas, synthetic data, and secrets.
2. Unit tests: parsers, intermediate models, compiler, browser action interpreter, assertions, and redaction.
3. Platform integration tests: generated Imposter behavior, browser journeys, gateway routing, isolation, and cleanup.
4. GL-EYE target acceptance tests: selected complete scenarios against the actual test environment.

### Reporting

Generate:

- Canonical JSON report.
- Static HTML report.
- Sanitized correlated timeline.
- Assertion summary.
- Provider call sequence.
- Browser action sequence.
- Source links to vendor cases and journey steps.
- Screenshot and trace links.
- Runtime and image versions.
- Scenario, bundle, and artifact hashes.

### Security and privacy

- Deny unexpected egress.
- Reject publicly routable fixture IPs.
- Allow only approved `.test`, `.example`, and `.invalid` fixture domains.
- Scan fixtures for credentials and personal data.
- Redact authorization values, cookies, raw contacts, full IPs, and form values.
- Apply short artifact retention.
- Authenticate internal service APIs.
- Run services on a private Compose network.
- Require explicit review for new actions, matchers, faults, or generated scripts.

### Reliability tests

- Kill the Control Plane during each active lifecycle state.
- Kill an Imposter runtime during a run.
- Kill a browser worker.
- Cancel during browser execution.
- Cancel during observation.
- Simulate a PostgreSQL restart.
- Verify stale-resource reaping.
- Verify cleanup can be run repeatedly.
- Run parallel isolation soak tests.
- Run mutation tests proving assertions detect broken behavior.

### Exit criteria

- Docker Compose starts the platform without production credentials.
- Corporate identification and enrichment work without live vendors.
- New supported provider cases are configuration-only.
- New supported customer journeys are configuration-only.
- Failures and recovery are deterministic.
- Unsafe attribution is suppressed.
- Retry and idempotency behavior is externally assertable.
- Tenant isolation is externally verified.
- Reports contain no prohibited data.
- Unexpected egress fails the run.

## 5. Parallel workstreams

Some work should proceed across multiple phases rather than being deferred to the final week.

### A. GL-EYE testability

**Owner:** GL-EYE engineer

- Provider endpoint configuration.
- Trusted gateway configuration.
- Tenant and site provisioning.
- Test authentication.
- Processing-status observation.
- Company and score observation.
- Tenant-isolation observation.
- Cleanup interface.

This is the project's most important external dependency.

### B. Privacy and security

**Owner:** Platform engineer with security review

- Synthetic IP validation.
- Synthetic-domain validation.
- Redaction.
- Fixture scanning.
- Egress policy.
- Artifact retention.
- Service authentication.
- Threat modelling.

### C. Developer experience

**Owner:** Platform engineer or SDET

- CLI.
- Validation messages.
- Example packages.
- Schema documentation.
- IDE schema associations.
- Compile preview.
- Local troubleshooting.
- Report usability.

### D. Test coverage

**Owner:** SDET

- Primitive contract tests.
- Golden compiler tests.
- Browser action tests.
- Mutation tests.
- Parallel isolation tests.
- Failure and cleanup tests.
- Target acceptance suites.

## 6. Initial epic backlog

### Epic 1 — Platform foundation

- Initialize the monorepo.
- Configure strict TypeScript.
- Add Docker Compose.
- Add PostgreSQL migrations.
- Add CI and security scans.
- Implement shared identifiers and errors.

### Epic 2 — Configuration infrastructure

- YAML loader.
- JSON Schema validation.
- Reference resolver.
- Source-location diagnostics.
- Fragment composition.
- Version compatibility.
- Content hashing.

### Epic 3 — Vendor simulator

- Vendor execution model.
- Imposter compiler.
- Runtime lifecycle.
- Source mapping.
- Call ledger.
- Fault and sequence primitives.

### Epic 4 — Vendor packages

- IPinfo.
- Apollo.
- Hunter.
- Synthetic response fixtures.
- Provider package contract suites.

### Epic 5 — Browser automation

- Customer, site, page, persona, and journey schemas.
- Synthetic site host.
- Playwright action registry.
- Fragment expansion.
- Browser contexts and session state.
- Trace, screenshot, and network capture.

### Epic 6 — Scenario orchestration

- Run state machine.
- Resource leasing.
- Sequential and parallel execution.
- Eventual observation.
- Cancellation.
- Cleanup and stale-resource recovery.

### Epic 7 — Gateway and target integration

- Traffic Gateway.
- Synthetic IP leasing.
- Destination allowlists.
- GL-EYE adapter.
- Provisioning and observation.
- Tenant isolation.

### Epic 8 — Assertions and reports

- Browser assertions.
- Provider assertions.
- Business outcome assertions.
- Privacy assertions.
- Network assertions.
- JSON and HTML reports.
- Correlated timeline.

### Epic 9 — Readiness

- Full vertical slice.
- CI acceptance suite.
- Parallel-run tests.
- Failure injection.
- Documentation.
- Operational runbooks.
- Architecture and security approval.

## 7. Key project risks

| Risk | Response |
|---|---|
| GL-EYE cannot externally expose completion or outcomes | Make the target test contract a Week 1 deliverable and block the vertical slice until it is approved. |
| Imposter cannot reliably implement required faults | Prove every primitive in the initial spike and remove unsupported primitives from schema v1. |
| YAML turns into an unmaintainable programming language | Keep a small set of typed primitives; prohibit arbitrary JavaScript and general-purpose expressions. |
| Provider and browser definitions become incompatible over time | Version schemas and provide validation plus migration tooling. |
| Parallel runs leak state | Use one runtime per active run, browser-context isolation, run-scoped routes, and concurrency contract tests. |
| The synthetic-IP gateway creates a security weakness | Restrict it to isolated environments, authenticate routes, strip inbound forwarding headers, and reject unknown leases. |
| Tests depend on fragile dashboard markup | Prefer target status APIs for business assertions and enforce stable semantic selectors for genuine UI checks. |
| Reports leak sensitive values | Use allowlist-based capture, centralized redaction, prohibited-data tests, and short artifact retention. |
| Platform tests only itself and misses GL-EYE integration failures | Maintain a small reference SUT for fast platform tests plus a separate GL-EYE acceptance suite. |

## 8. Definition of MVP complete

The MVP is complete when:

1. A developer can start the platform locally using Docker Compose.
2. A QA engineer can create a supported vendor case through YAML and fixtures only.
3. A QA engineer can create a supported customer journey through YAML only.
4. The vertical-slice scenario runs against GL-EYE without live vendor credentials.
5. Provider failures, retries, quotas, timeouts, conflicts, and recovery are deterministic.
6. Corporate, residential, VPN, hosting, and unknown visitor outcomes are correctly distinguished.
7. Duplicate events do not create duplicate companies or scores.
8. Tenant isolation is verified through GL-EYE's external interfaces.
9. Concurrent runs do not share provider, browser, gateway, target, or artifact state.
10. Every run produces a sanitized JSON and HTML report.
11. Unexpected network egress fails the test.
12. Cleanup succeeds after passes, failures, cancellations, and process interruptions.
13. CI contains static, unit, platform-integration, and GL-EYE acceptance layers.
14. The Imposter image, Node runtime, package manager, browser version, and container digests are pinned.
15. Architecture, privacy, security, and GL-EYE integration owners approve the readiness gate.

## 9. First implementation sprint

The first sprint should produce a thin but executable foundation rather than only documentation.

### Sprint backlog

1. Initialize the TypeScript monorepo.
2. Add Docker Compose with PostgreSQL and a placeholder Control Plane.
3. Implement `/v1/health` and `/v1/readiness`.
4. Add the first database migration for `test_runs`.
5. Create vendor schema v1 skeletons.
6. Create a minimal IPinfo vendor fixture.
7. Run the Imposter spike in a container.
8. Compile one YAML case into a generated Imposter bundle.
9. Send one request and capture a sanitized provider-call record.
10. Add CI for type checking, tests, schema validation, and secret scanning.
11. Draft and review the GL-EYE target integration contract.
12. Publish the runtime and licence decision as an ADR.

### Sprint demo

At the end of the sprint, the team should be able to run:

```bash
docker compose up -d
pnpm test
pnpm testy vendor validate ipinfo
pnpm testy vendor compile ipinfo
pnpm testy spike imposter
```

The demo should show one synthetic IPinfo lookup, the matched case, a sanitized call-ledger entry, and complete runtime cleanup.

## 10. Immediate decision required

The most important sequencing decision is to complete the **GL-EYE target-adapter contract in Phase 0**. Leaving provider URL configuration, resource provisioning, completion observation, and outcome observation until the vertical-slice phase would create the largest delivery risk in the plan.
