# IPinfo synthetic vendor package

This package is the first executable example of the Testy McTestface vendor DSL.
It uses only RFC documentation-range IP addresses and `.test` domains.

## Included behavior

- Bearer-token authentication with a synthetic credential.
- Healthy, degraded, unavailable, and quota-exhausted system states.
- Corporate, residential, unknown, and timeout lookup cases.
- Timeout → unavailable → recovered ordered sequence.
- Explicit transition into `unavailable`, followed by request-count recovery.
- Namespaced stores recording recovery attempts, outcomes, and trigger state.
- Privacy-safe capture rules that redact authorization and cookie headers.

Validate and compile it from the repository root with:

```bash
pnpm vendor:validate
pnpm vendor:compile
```
