# IPinfo synthetic vendor package

This package is the first executable example of the Testy McTestface vendor DSL.
It uses only RFC documentation-range IP addresses and `.test` domains.

## Included behavior

- Bearer-token authentication with a synthetic credential.
- Healthy, degraded, unavailable, and quota-exhausted system states.
- Separate modern IPinfo Core (`/lookup/{ip}`) and IPinfo Lite (`/lite/{ip}`) contracts so the target application's configured product determines which fake shape is exercised.
- Core fixtures include geo, AS type, hosting, and anonymity signals; Lite fixtures use the flat `asn`, `as_name`, `as_domain`, country, and continent fields.
- Timeout → unavailable → recovered ordered sequence.
- Explicit transition into `unavailable`, followed by request-count recovery.
- Namespaced stores recording recovery attempts, outcomes, and trigger state.
- Privacy-safe capture rules that redact authorization and cookie headers.

Validate and compile it from the repository root with:

```bash
pnpm vendor:validate
pnpm vendor:compile
```
