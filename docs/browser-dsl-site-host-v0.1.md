# Browser DSL and synthetic site host v0.1

This slice establishes the configuration and hosting boundary for browser journeys. It intentionally does not launch Playwright yet; the next slice consumes the resolved journey model and the deterministic site binding.

## Package layout

A browser package contains:

```text
customers/<customer>/
├── customer.yaml
├── site.yaml
├── personas/
├── journeys/
└── fragments/
```

`customer.yaml` declares the referenced files and the default artifact policy. All references are package-relative and path-confined.

## Versioned schemas

`@testy/browser-schema` publishes Draft 2020-12 schemas for:

- customer metadata and artifact policy;
- deterministic site pages and elements;
- personas, browser settings, cookies, and local storage;
- journeys and reusable fragments;
- network fixtures;
- browser actions and selectors.

The initial action model covers navigation, interaction, waiting, assertions, session state, tabs, and screenshots. Actions remain data-only; journey and fragment files cannot contain JavaScript.

## Selector policy

Selectors are represented as one of:

```yaml
selector:
  testId: submit-lead
```

```yaml
selector:
  role: button
  name: Submit
```

```yaml
selector:
  label: Work email
```

```yaml
selector:
  placeholder: qa@example.test
```

A CSS selector is accepted only when the journey explicitly sets `allowCssFallback: true`. Positional selectors and XPath are rejected. `data-test` values are unique across the site, and test-ID selectors must reference a declared value.

The Playwright runner will configure `data-test` as its custom test-ID attribute. Playwright documents test IDs, roles, labels, and placeholders as resilient locator strategies, while locator APIs remain strict and retryable.

## Deterministic site host

`@testy/synthetic-site-host` renders site configuration without user-authored templates or scripts. It supports:

- headings, text, links, buttons, forms, selects, checkboxes, and inputs;
- safe variable interpolation with HTML escaping;
- generated consent behavior backed by cookies or local storage;
- generated page-view, consent, and button tracking;
- deterministic form redirects;
- run-specific synthetic hostnames;
- a localhost preview origin and health endpoint;
- no-store responses and a restrictive content-security policy.

Submitted form values are never retained. The host records only sorted field names and a SHA-256 body fingerprint.

## Resolution

`@testy/browser-config`:

1. validates every YAML file against its versioned schema;
2. confines all references to the package root;
3. rejects duplicate IDs, routes, and `data-test` values;
4. verifies persona, fragment, page, and selector references;
5. rejects unsafe external URLs and fragile selectors;
6. expands reusable fragments;
7. merges customer and journey artifact policy;
8. substitutes site and persona variables;
9. produces deterministic package and resolved-journey hashes.

## Sample fixture

`customers/customer-alpha` provides:

- four deterministic pages;
- consent controls;
- a synthetic tracking endpoint;
- a lead form with privacy-safe capture;
- an isolated corporate visitor persona;
- a reusable consent fragment;
- a lead-capture journey with navigation, form interaction, assertions, and artifact policy.

## Commands

Validate and resolve the sample browser package:

```bash
pnpm browser:validate
```

Start the synthetic site preview:

```bash
pnpm site:serve
```

The preview prints both a synthetic run hostname and a directly reachable localhost origin. The next Playwright slice will map the synthetic hostname into an isolated browser context.

## Verification boundary

This slice includes strict TypeScript checks, Draft 2020-12 schema checks, loader/resolver tests, selector-policy tests, and host tests. A local host smoke test verifies rendering, form redirect behavior, and privacy-safe event capture.

Browser launch, locator execution, traces, screenshots, context isolation, multi-tab behavior, and network fixture routing are intentionally deferred to the Playwright runner slice.
