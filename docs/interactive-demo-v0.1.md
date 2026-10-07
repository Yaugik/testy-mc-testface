# Interactive Demo / Visitor Simulator

Interactive Demo is a first-class Testy Control Plane mode for manual GL-EYE QA,
debugging, and demonstrations. It is additive: the existing automated scenario
engine and `customer-alpha-gl-eye-local` remain the deterministic regression path.

## Local usage

Terminal 1, in GL-EYE:

```sh
./bin/testy-dev
```

Terminal 2, in Testy:

```sh
./bin/test-gl-eye
```

Open the Control Plane at `http://127.0.0.1:23000`, choose **Interactive Demo**,
then:

1. Choose **Reusable credential** or **Generate for this session**, then Start Demo.
2. Copy the displayed GL-EYE email/password and note the unique session/workspace id.
3. Select a network identity, compatible person identity, and browser identity.
4. Apply Visitor.
5. Open Demo Website.
6. Browse the synthetic site normally in Safari, Chrome, or another host browser.
7. Watch site activity, Traffic Gateway forwarding, provider calls, and the real
   GL-EYE test-support outcome.
8. Switch visitors and repeat.
9. Stop Demo. The session workspace is hard-deleted at this point.

## Architecture

Interactive Demo owns a persisted `interactive_demo_sessions` record and reuses
the existing Testy run evidence/resource-lease tables through an
`interactive-demo` run envelope. It invokes the same platform actions used by
automated scenarios for:

- provider package compilation and Imposter runtimes;
- GL-EYE Testy run preparation and cleanup;
- Traffic Gateway routes;
- synthetic customer site lifecycle;
- provider ledgers and evidence;
- target observations and outcomes.

The session lifecycle is:

`CREATE -> PROVISIONING -> READY -> ACTIVE -> STOPPING -> STOPPED`

Provisioning failures become `FAILED`. Active sessions have a bounded TTL.
Each session has a UUID and a dedicated GL-EYE workspace named from that UUID.
The Control Plane can use the stable seeded demo login or generate a new
session-specific login. The active password is retained only while the demo is
live so restart recovery can re-provision the same target run.

Normal Control Plane shutdown suspends local runtimes for recovery. Explicit
Stop Demo or TTL expiry performs target cleanup; for Interactive Demo that
cleanup hard-deletes the session workspace and tenant-scoped data. Testy keeps
the stopped session/evidence record but clears the stored demo password.

## Demo login and workspace lifecycle

**Reusable** mode uses `admin@example.com` / `Demo-Access9!` and attaches that
existing demo user to each new session workspace. **Generated** mode creates a
unique `demo-<session>@example.com` account and random password for the session.

Both modes create a fresh workspace for every session. Credentials are shown in
the Control Plane together with the session ID and workspace name. Stopping the
session removes the workspace completely. A generated user is removed when it
has no remaining workspace memberships; the reusable account remains because
it is also a member of the seeded demo workspace.

## Visitor model

`customers/customer-alpha/visitor-profiles.json` separates:

- network identity: synthetic IP, classification, country, optional company;
- person identity: company, synthetic name/email/title, provider profile;
- browser identity: whether applying it requires a clean browser identity.

The initial catalog includes:

- Nordlicht Example GmbH / Alex Sales;
- Nordlicht Example GmbH / Maya Schmidt using the same corporate network;
- Acme Synthetic Ltd / Sarah Demo;
- residential;
- VPN;
- hosting/datacenter;
- unknown/unresolved.

All IPs use RFC 5737 documentation ranges and all work email domains use
`.test`.

## Visitor switching

Applying a network identity creates a new Traffic Gateway route and retires the
previous route. This keeps route history immutable while making the newly
selected synthetic IP active.

Apollo and Hunter reuse their existing run-scoped Imposter runtimes. The
selected person changes the Testy-only provider endpoint suffix, for example
`/profiles/nordlicht-maya`. Provider response JSON is never edited from the UI.

Each Apply Visitor or Reset Visitor starts a new target-result observation
window. GL-EYE test-support outcome/enrichment calls receive `since=<timestamp>`
so the result panel represents the current visitor instead of historical
companies from earlier visitors in the same long-lived demo.

## Manual browser bridge

The host browser opens a unique local-only hostname such as
`http://demo-<id>.localhost:23000`.

The Control Plane proxies that hostname to the existing synthetic-site host.
The synthetic site injects the real GL-EYE tracking script using a same-origin
Testy path:

`/sdk/track.v1.min.js`

Testy fetches the real SDK from the prepared GL-EYE test run internally. The SDK
posts to its normal same-origin `/t/v1/events` path. Testy forwards that traffic
through the active Traffic Gateway route with the route token/run ID and the
configured synthetic origin. No browser-facing Docker DNS name is exposed and
tracking events are not fabricated by the Control Plane.

A reset version is injected before the SDK. When it changes, the browser clears
localStorage, sessionStorage, and cookies before the tracking SDK boots. A
returning/same-session identity keeps the existing browser state.

## APIs

- `GET /v1/demo-profiles`
- `POST /v1/demo-sessions`
- `GET /v1/demo-sessions/:id`
- `POST /v1/demo-sessions/:id/visitor`
- `POST /v1/demo-sessions/:id/reset-visitor`
- `GET /v1/demo-sessions/:id/activity`
- `GET /v1/demo-sessions/:id/outcome`
- `DELETE /v1/demo-sessions/:id`

## GL-EYE change

GL-EYE required a minimal, test-support-only extension because the previous
outcome endpoint exposed company counts/fingerprints but not the actual
synthetic company names and was cumulative across the whole test tenant.

The existing `/test-support/v1/runs/{targetRunId}/outcome` now:

- exposes synthetic company summaries from the isolated Testy tenant;
- optionally accepts `since` to scope companies/events to the current visitor.

The existing enrichment trigger also optionally accepts `since`, preventing a
new visitor profile from refreshing companies observed only during older
visitor windows.

These changes are behind the existing Testy-only access middleware and do not
change normal production routes or `./bin/dev`.

## Verification coverage

New/extended tests cover:

- visitor catalog validation and composition;
- same-company/different-person identity behavior;
- different-company and anonymous network cases;
- gateway route replacement;
- manual SDK proxy and event forwarding;
- demo service provisioning, visitor switching, browser reset, outcome refresh,
  enrichment trigger, and cleanup;
- GL-EYE test-support company summaries and visitor-window filtering.

The existing automated GL-EYE scenario was not replaced or edited.
