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

Open the Control Plane at `http://127.0.0.1:23000`, choose **Visitor simulator**,
then:

1. Open a shared session from the **Active** sidebar, or choose **New session**.
2. In the creation dialog, choose a reusable or generated demo account and
   optionally keep the workspace after timeout, then choose **Create session**.
3. Select a network, compatible person, and browser identity. **Not applied**
   indicates a draft selection; polling preserves those choices.
4. Choose **Apply visitor**, then **Open demo website**. Opening is disabled
   until the draft matches the applied visitor.
5. Browse the synthetic site normally in Safari, Chrome, or another host browser.
6. Inspect the adjacent GL-EYE result and **Recent activity**. Successful routine
   evidence observations appear under **Polling diagnostics**; failures and
   visitor/provider events remain visible in recent activity.
7. Expand **GL-EYE login & workspace** to copy credentials and inspect the UUID.
   Passwords stay masked until explicitly revealed.
8. Switch visitors and repeat. Results reflect the applied visitor, and a
   successful apply/reset clears the previous observation window from the UI.
9. Expand **Session options** and choose **Save & pause** to preserve the
   workspace and stop traffic, or **Delete workspace** to open the permanent
   deletion confirmation. Deletion still requires typing `DELETE`.
10. Open **Saved / failed** in the sidebar to inspect a saved or failed session.
    A saved session retains its login and can be resumed with **Resume session**.

Creation options affect the new session only. They are separate from the selected
workspace, and a failed creation request leaves the previous selection intact.

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

`CREATE -> PROVISIONING -> READY -> ACTIVE -> HIBERNATING -> HIBERNATED -> RESUMING -> READY`

A separate explicit **Delete Session & Workspace** action ends in `STOPPED`. A hibernated session may be resumed repeatedly, with a fresh activity TTL, using the same UUID, GL-EYE tenant, tracking key and historical data.

Provisioning failures become `FAILED`. Active sessions have a bounded TTL.
Each session has a UUID and a dedicated GL-EYE workspace named from that UUID.
The Control Plane can use the stable seeded demo login or generate a new
session-specific login. The session password remains available while the workspace
is hibernated so the saved account can be used in GL-EYE and the demo can be resumed.
It is cleared only after successful **permanent deletion**.

Normal Control Plane shutdown suspends local runtimes for recovery. Hibernate
shuts down the synthetic site, provider runtimes and gateway route, releases the
destructive target resource lease, disables GL-EYE site tracking, and retains
the GL-EYE workspace, memberships, data and test-support run. Automatically
expired sessions hibernate when **Keep workspace after timeout** was chosen;
otherwise they are permanently deleted. Hibernated sessions are excluded from
expiration until manually resumed/deleted. A permanent Delete hard-deletes both
the workspace and all tenant-scoped data. Testy retains the stopped session/evidence
record but clears the stored password.

## Demo login and workspace lifecycle

**Reusable** mode uses `admin@example.com` / `Demo-Access9!` and attaches that
existing demo user to each new session workspace. **Generated** mode creates a
unique `demo-<session>@example.com` account and random password for the session.

Both modes create a fresh workspace for every session. Credentials are shown in
the Control Plane together with the session ID and workspace name. The seeded
GL-EYE Demo Company users are always given membership in every Interactive Demo
workspace, regardless of which login mode was chosen, and a migration backfills
those memberships for already-existing workspaces.

The **Active** and **Hibernated** subtabs list server-backed sessions to all
operators of the same Control Plane, including those opening it from a different
computer. Joining a session loads its UUID and live/hibernated controls. The
selected session ID is stored in browser localStorage and synchronized via the
storage event, so multiple tabs use the same selected session; credentials are
never stored in localStorage. All operators who can access this Control Plane
can mutate shared sessions, including permanently deleting them. Deploy it only
behind an appropriate access control (VPN/SSO/reverse-proxy authentication).

On permanent deletion, generated users are removed when no other memberships
remain; seeded/reusable demo users retain membership in their permanent demo tenant.

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
- `GET /v1/demo-sessions` (shared Active/Hibernated session summaries, no passwords)
- `GET /v1/demo-sessions/:id`
- `POST /v1/demo-sessions/:id/visitor`
- `POST /v1/demo-sessions/:id/reset-visitor`
- `GET /v1/demo-sessions/:id/activity`
- `GET /v1/demo-sessions/:id/outcome`
- `POST /v1/demo-sessions/:id/hibernate`
- `POST /v1/demo-sessions/:id/resume`
- `DELETE /v1/demo-sessions/:id` (hard-delete, irreversible)

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
