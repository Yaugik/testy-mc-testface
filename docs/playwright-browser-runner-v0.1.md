# Playwright browser runner v0.1

This slice executes resolved Browser DSL journeys in real Playwright browser contexts.
It consumes `ResolvedJourney` from `@testy/browser-config` and a temporary site binding
from `@testy/synthetic-site-host`.

## Isolation model

Every journey run launches a fresh browser context with the persona locale, timezone,
viewport and color scheme. Cookies and local-storage values are applied only to that
context. Service workers are blocked so configured network routes cannot be bypassed.
The context, all tabs and the browser are closed on pass, failure or cancellation.

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

Each action produces a sanitized timing record with the step ID, action, status,
duration and current page URL. Execution stops at the first failed action.

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
- selected request metadata.

Request records retain method, status and a SHA-256 URL fingerprint after query and
fragment removal. Query values and request bodies are never written to the browser
report. Artifact paths are confined under a sanitized run and journey namespace.

`report.json` records the resolved journey hash, action timeline, artifact manifest and
sanitized failure message. On-failure screenshot and trace behavior is applied even
when action execution aborts early.

## Commands

Install Chromium once:

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

Unit tests cover artifact policy, artifact-name confinement, URL fingerprinting and
network matching without launching a browser. The runner is implemented against the
Playwright library APIs for contexts, routing, locators, screenshots and tracing.

A real browser execution was not performed in the current development environment
because Playwright browser binaries and workspace dependencies are unavailable. The
release gate must install the pinned browser binary and run `pnpm browser:run`, followed
by parallel-context, returning-session, popup and deliberate-failure artifact tests.
