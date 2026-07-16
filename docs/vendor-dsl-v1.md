# Vendor DSL v1

Vendor packages describe provider behavior independently of the Imposter runtime.
The first schema version supports vendor identity, routing, authentication,
system states, response assets, request matching, HTTP responses, and basic
transport faults.

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

## Compilation

`@testy/vendor-compiler` converts the execution model into a self-contained
Imposter bundle containing:

- `manifest.json` with source and output hashes, runtime metadata and warnings;
- `source-map.json` linking generated resources to DSL cases;
- `imposter/vendor-config.json`;
- copied response assets.

Compilation fails when a DSL primitive cannot be represented safely by the
approved native Imposter subset. It does not silently inject arbitrary scripts.

## Current limits

System-state transitions and counters are preserved as declarations but are not
yet active in the generated runtime. Ordered sequences, store mutation, OpenAPI
validation and a distinct connection-reset primitive remain deferred until their
runtime contracts are verified.
