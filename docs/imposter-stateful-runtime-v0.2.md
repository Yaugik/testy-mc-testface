# Stateful Imposter runtime v0.2

This slice activates the stateful primitives declared by Vendor DSL v1. It
extends the deterministic Imposter bundle with generated scripts and isolated
stores while retaining the platform rule that vendor authors cannot supply
arbitrary JavaScript.

## Runtime contract

The implementation uses documented Imposter capabilities:

- scripts can inspect the request and control response status, files, headers,
  delays, and failure simulation;
- scripts can open, load, save, test, and delete store items;
- stores can be preloaded through `system.stores.*.preloadData`;
- the store REST API is available under `/system/store`;
- `withDelay(...)` and `withFailure("CloseConnection")` provide dynamic latency
  and connection-close behavior.

References:

- <https://docs.imposter.sh/scripting/>
- <https://docs.imposter.sh/stores/>
- <https://docs.imposter.sh/performance_simulation/>
- <https://docs.imposter.sh/failure_simulation/>
- <https://docs.imposter.sh/steps/>

## Generated stores

Each stateful bundle contains isolated physical stores:

- current system state;
- request counters per state;
- sequence positions per operation/case;
- one generated store for each logical DSL store.

The physical names include the run namespace and vendor identifier. The mapping
is recorded in `manifest.json`.

## System-state semantics

For every matched or unmatched provider request:

1. load the current state;
2. increment that state's request counter;
3. select the case response or sequence step;
4. apply the current state's override or default delay;
5. apply case and step store effects;
6. apply an explicit state effect, or evaluate automatic transitions;
7. persist the next state for the following request;
8. emit a privacy-safe `TESTY_STATE` diagnostic;
9. return the selected response/fault.

Transitions count requests made while the provider is in the `from` state. The
request that reaches the threshold still receives the old state's behavior; the
new state applies to the next request.

## Ordered sequences

Sequences maintain a store-backed position per operation and case. Exhaustion
behavior is explicit:

- `repeat-last`: hold the final step;
- `cycle`: return to the first step;
- `terminal`: return a dedicated terminal response.

Sequence steps can independently define responses, transport faults and effects.

## Runtime inspection and reset

`RunningVendorRuntime` now exposes:

- `readStore(name)`;
- `stateSnapshot()`;
- `resetState()`.

The state snapshot returns current state, counters, sequence positions and
logical user-store contents. Reset clears counters, sequences and user data,
then restores the manifest's initial state.

The container remains bound to localhost, and the store API is explicitly
permitted only inside the isolated runtime when native authentication is active.

## IPinfo recovery fixtures

The synthetic IPinfo package now includes:

- timeout → 503 → corporate success, repeating the recovered result;
- a state-changing unavailable trigger;
- automatic recovery from `unavailable` to `healthy` after three requests;
- logical stores recording attempts, last outcomes and state triggers.

## Verification boundary

Pure generated-script tests execute the emitted JavaScript with fake Imposter
stores and response builders. They verify sequence advancement, repeat-last
behavior, store mutation, explicit state changes and request-count recovery.

A real Docker capability suite is still required to confirm concurrency and the
final digest-pinned Imposter image.
