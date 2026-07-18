# Vendor DSL v1

Vendor packages describe provider behavior independently of the Imposter runtime.
The first schema version supports vendor identity, routing, authentication,
system states, response assets, request matching, HTTP responses, transport
faults, ordered response sequences, state changes, and namespaced store effects.

## Package layout

```text
vendors/<vendor-id>/
├── vendor.yaml
├── system-cases.yaml
├── apis/
│   └── <operation>.yaml
└── responses/
```

All response paths are resolved relative to the vendor package root. Absolute
paths and paths that escape the package are rejected.

## Validation

Validation has four layers:

1. YAML syntax and duplicate-key checking.
2. Versioned JSON Schema validation with file and line diagnostics.
3. Package semantics, including duplicate operation/case identifiers and valid
   system-state references.
4. Response-asset confinement and existence checks.

A successful load produces a deterministic SHA-256 content hash and a
runtime-neutral `VendorExecutionModel`. Imposter-specific concepts do not appear
in author files.

## Stateful cases

A case can return one response/fault, or an ordered sequence:

```yaml
- id: transient-recovery
  priority: 100
  when:
    path.ip: "198.51.100.61"
  effects:
    stores:
      - store: recovery
        key: attempts
        operation: increment
  sequence:
    onExhausted: repeat-last
    steps:
      - transport:
          type: timeout
          duration: 2s
      - respond:
          status: 503
          body: responses/unavailable.json
      - respond:
          status: 200
          body: responses/corporate.json
```

`onExhausted` supports:

- `repeat-last`;
- `cycle`;
- `terminal`, with an explicit `terminalResponse`.

Case and sequence-step effects can:

- set the current system state;
- set a store value;
- increment a numeric store value;
- delete a store value.

Logical store identifiers are mapped to generated run/vendor-scoped Imposter
store names. Authors never select the physical runtime store name.

System transitions use request counts within the current state. A transition
whose threshold is met takes effect on the following request. An explicit
`setState` effect takes precedence over an automatic transition for that request.

## Compilation

`@testy/vendor-compiler` converts the execution model into a self-contained
Imposter bundle containing:

- `manifest.json` with source/output hashes, runtime metadata, store layout and
  warnings;
- `source-map.json` linking generated resources and scripts to DSL cases;
- `imposter/vendor-config.json`;
- generated JavaScript response scripts for approved stateful primitives;
- copied response assets.

Generated scripts are compiler output, not author-supplied JavaScript. The
compiler embeds a bounded, reviewed runtime plan and rejects unsupported
primitives rather than executing arbitrary configuration code.

## Remaining limits

- A distinct connection-reset primitive remains unsupported.
- OpenAPI-backed request validation is not implemented.
- Store increments use Imposter's store load/save API and still require
  concurrency verification against the selected runtime image.
- Final runtime-image digest and licensing approval remain outstanding.
