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
runtime-neutral `VendorExecutionModel`. The model is the input to the future
Imposter compiler; Imposter-specific concepts do not appear in author files.

## Current limits

The first slice intentionally does not yet compile or launch Imposter. Ordered
sequences, store mutation, scenario overrides, OpenAPI validation, and advanced
state predicates will be added after the runtime capability spike confirms the
supported primitives.
