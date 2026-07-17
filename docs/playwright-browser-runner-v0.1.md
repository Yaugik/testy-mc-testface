# Playwright browser runner v0.1

This slice executes resolved Browser DSL journeys in real Playwright browser contexts.
It consumes `ResolvedJourney` from `@testy/browser-config` and a temporary site binding
from `@testy/synthetic-site-host`. The package pins Playwright `1.59.1` so the library
and installed browser binary remain aligned.

## Isolation model

Every journey run launches a fresh browser context with the persona locale, timezone,
viewport and color scheme. Cookies and local-storage values are applied only to that
context and remapped to the run-specific synthetic origin. Service workers are blocked
so configured network routes cannot be bypassed.

An external abort signal closes the active context immediately, including while an
action is waiting. The resolved journey timeout is also enforced as a total run limit.
The context, all tabs and the browser are closed on pass, failure, timeout or cancellation.

Playwright documents browser contexts as independent, incognito-like sessions with
separate cookies, local storage and session storage. This is the platform boundary used
for persona and parallel-run isolation.

## Locator execution

The runner configures `data-test` as Playwright's test-ID attribute and translates DSL
selectors into:

- `getByTestId`;
- `getByRole` with accessible name;
- `getByLabel`;
- `getByPlaceholder`;
- explicitly approved CSS locators.

These locators retain Playwright's auto-waiting and retry behavior. The configuration
loader continues to reject positional CSS and XPath before execution.

## Supported actions

The executor implements the initial navigation, interaction, waiting, assertion,
session, tab and artifact actions:

- open, navigate, reload, back and forward;
- click, double-click, hover, fill, form fill, select, check, uncheck and submit;
- fixed waits and request, response and popup waits;
- visible, hidden, text, URL, attribute and request assertions;
- cookie and local-storage mutation;
- open, switch and close tab;
- explicit screenshots.

Duplicate tab names are rejected. Each action produces a sanitized timing record with
the step ID, action, status, duration and current page URL without query or fragment
values. Execution stops at the first failed action.

## Network fixtures and synthetic host routing

The browser navigates to the run-specific synthetic hostname. A context route proxies
that hostname to the bound localhost site without changing the browser-visible origin.
Journey network fixtures are installed as context routes with optional method matching,
status, headers, body and deterministic delay.

Routing is installed at browser-context scope so every tab receives the same fixture
policy. Service workers are disabled because Playwright notes they can prevent context
routing from intercepting requests.

## Artifacts and privacy

The runner supports customer/journey artifact policy for:

- full-page screenshots;
- Playwright traces with screenshots, DOM snapshots and sources;
- console entries;
- failed-request records;
- selected sanitized HAR output.

Request records retain method, status and a SHA-256 URL fingerprint after query and
fragment removal. Query values and request bodies are never written to the browser
report. Console text and transport failure text are stored only as SHA-256 fingerprints.
The selected-HAR artifact uses fingerprint URNs instead of raw URLs and contains no
headers, cookies, query values or bodies. Trace paths are included only when trace
creation succeeds.

Artifact paths are confined under a sanitized run and journey namespace. `report.json`
records the resolved journey hash, action timeline, artifact manifest and failure
summary. On-failure screenshot and trace behavior is applied when execution aborts
early because of an action failure or timeout.

## Commands

Install the pinned Chromium binary once:

```bash
pnpm browser:install
```

Run the sample journey:

```bash
pnpm browser:run
```

Environment controls:

- `TESTY_BROWSER=chromium|firefox|webkit`;
- `TESTY_HEADLESS=false` for visible local execution.

## Verification boundary

The final pass uses strict TypeScript with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. Focused utility assertions cover artifact policy, artifact
name confinement, query-free page URLs, URL and console fingerprinting, failed-request
selection and method-constrained network matching.

A real browser execution was not performed in the current development environment
because the Playwright browser binary is unavailable. The release gate must install the
pinned browser binary and run `pnpm browser:run`, followed by parallel-context,
returning-session, popup and deliberate-failure artifact tests.
