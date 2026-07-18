import type {
  CaseEffectsDefinition,
  OperationCaseDefinition,
  ResponseDefinition,
  StoreMutationDefinition,
  SystemStateDefinition,
  TransportFaultDefinition,
  VendorExecutionModel,
} from "@testy/vendor-schema";

import { canonicalJson } from "./canonical-json.js";

export interface StatefulStoreLayout {
  readonly state: string;
  readonly counters: string;
  readonly sequences: string;
  readonly user: Readonly<Record<string, string>>;
}

export interface StatefulScriptContext {
  readonly vendorId: string;
  readonly operationId: string;
  readonly caseId: string;
  readonly initialState: string;
  readonly states: Readonly<Record<string, SystemStateDefinition>>;
  readonly transitions: readonly {
    readonly from: string;
    readonly to: string;
    readonly when: { readonly requestCountAtLeast: number };
  }[];
  readonly operationCase: OperationCaseDefinition;
  readonly stores: StatefulStoreLayout;
}

interface ScriptResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly contentType?: string;
  readonly body?: string;
  readonly delayMs?: number;
  readonly failure?: "CloseConnection";
}

interface ScriptEffects {
  readonly setState?: string;
  readonly stores?: readonly {
    readonly store: string;
    readonly key: string;
    readonly operation: "set" | "increment" | "delete";
    readonly value?: unknown;
  }[];
}

interface ScriptSequenceStep {
  readonly behavior: ScriptResponse;
  readonly effects?: ScriptEffects;
}

interface ScriptPlan {
  readonly vendorId: string;
  readonly operationId: string;
  readonly caseId: string;
  readonly initialState: string;
  readonly stores: StatefulStoreLayout;
  readonly states: Readonly<
    Record<
      string,
      {
        readonly defaultDelayMs?: number;
        readonly override?: ScriptResponse;
      }
    >
  >;
  readonly transitions: readonly {
    readonly from: string;
    readonly to: string;
    readonly requestCountAtLeast: number;
  }[];
  readonly behavior?: ScriptResponse;
  readonly sequence?: {
    readonly onExhausted: "repeat-last" | "cycle" | "terminal";
    readonly steps: readonly ScriptSequenceStep[];
    readonly terminalResponse?: ScriptResponse;
  };
  readonly effects?: ScriptEffects;
}

export function requiresStatefulExecution(model: VendorExecutionModel): boolean {
  if (model.system.transitions.length > 0) {
    return true;
  }

  return model.operations.some((operation) =>
    operation.cases.some(
      (operationCase) =>
        operationCase.sequence !== undefined ||
        operationCase.effects !== undefined,
    ),
  );
}

export function createStatefulStoreLayout(
  model: VendorExecutionModel,
  runNamespace?: string,
): StatefulStoreLayout {
  const namespace = sanitizeStoreSegment(
    [runNamespace, model.vendor.id].filter(Boolean).join("-") || model.vendor.id,
  );
  const userStoreIds = collectUserStoreIds(model);

  return {
    state: `testy_state_${namespace}`,
    counters: `testy_counters_${namespace}`,
    sequences: `testy_sequences_${namespace}`,
    user: Object.fromEntries(
      userStoreIds.map((storeId) => [
        storeId,
        `testy_data_${namespace}_${sanitizeStoreSegment(storeId)}`,
      ]),
    ),
  };
}

export function createStorePreloadData(
  model: VendorExecutionModel,
  stores: StatefulStoreLayout,
): Readonly<Record<string, { readonly preloadData: Readonly<Record<string, unknown>> }>> {
  const counterData = Object.fromEntries(
    model.system.states.map((state) => [state.id, "0"]),
  );

  return {
    [stores.state]: {
      preloadData: { currentState: model.system.initialState },
    },
    [stores.counters]: {
      preloadData: counterData,
    },
    [stores.sequences]: {
      preloadData: {},
    },
    ...Object.fromEntries(
      Object.values(stores.user).map((storeName) => [
        storeName,
        { preloadData: {} },
      ]),
    ),
  };
}

export function renderStatefulCaseScript(
  context: StatefulScriptContext,
): string {
  const plan: ScriptPlan = {
    vendorId: context.vendorId,
    operationId: context.operationId,
    caseId: context.caseId,
    initialState: context.initialState,
    stores: context.stores,
    states: Object.fromEntries(
      Object.entries(context.states)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([stateId, state]) => [
          stateId,
          {
            ...(state.defaults?.delay
              ? { defaultDelayMs: parseDuration(state.defaults.delay) }
              : {}),
            ...(state.override
              ? { override: normalizeResponse(state.override) }
              : {}),
          },
        ]),
    ),
    transitions: context.transitions.map((transition) => ({
      from: transition.from,
      to: transition.to,
      requestCountAtLeast: transition.when.requestCountAtLeast,
    })),
    ...(context.operationCase.respond
      ? { behavior: normalizeResponse(context.operationCase.respond) }
      : {}),
    ...(context.operationCase.transport
      ? { behavior: normalizeTransport(context.operationCase.transport) }
      : {}),
    ...(context.operationCase.sequence
      ? {
          sequence: {
            onExhausted: context.operationCase.sequence.onExhausted,
            steps: context.operationCase.sequence.steps.map((step) => ({
              behavior: step.respond
                ? normalizeResponse(step.respond)
                : normalizeTransport(step.transport as TransportFaultDefinition),
              ...(step.effects
                ? { effects: normalizeEffects(step.effects, context.stores) }
                : {}),
            })),
            ...(context.operationCase.sequence.terminalResponse
              ? {
                  terminalResponse: normalizeResponse(
                    context.operationCase.sequence.terminalResponse,
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(context.operationCase.effects
      ? { effects: normalizeEffects(context.operationCase.effects, context.stores) }
      : {}),
  };

  return `// Generated by Testy McTestface vendor compiler. Do not edit.
var plan = ${canonicalJson(plan)};

function asNumber(value) {
  var parsed = Number(value);
  return isFinite(parsed) ? parsed : 0;
}

function copyObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function selectSequence(sequenceStore) {
  if (!plan.sequence) {
    return { behavior: plan.behavior, effects: null, index: null };
  }

  var key = plan.operationId + "." + plan.caseId;
  var index = Math.max(0, Math.floor(asNumber(sequenceStore.load(key))));
  var steps = plan.sequence.steps;
  var selectedIndex = index;
  var terminal = false;

  if (index >= steps.length) {
    if (plan.sequence.onExhausted === "cycle") {
      selectedIndex = index % steps.length;
    } else if (plan.sequence.onExhausted === "repeat-last") {
      selectedIndex = steps.length - 1;
    } else {
      terminal = true;
    }
  }

  if (plan.sequence.onExhausted === "cycle") {
    sequenceStore.save(key, String((index + 1) % steps.length));
  } else if (!terminal && selectedIndex < steps.length - 1) {
    sequenceStore.save(key, String(selectedIndex + 1));
  } else {
    sequenceStore.save(key, String(steps.length));
  }

  if (terminal) {
    return {
      behavior: plan.sequence.terminalResponse,
      effects: null,
      index: index
    };
  }

  return {
    behavior: steps[selectedIndex].behavior,
    effects: steps[selectedIndex].effects || null,
    index: selectedIndex
  };
}

function applyState(behavior, stateDefinition) {
  if (stateDefinition && stateDefinition.override) {
    return copyObject(stateDefinition.override);
  }

  var effective = copyObject(behavior);
  if (
    stateDefinition &&
    stateDefinition.defaultDelayMs !== undefined &&
    effective.delayMs === undefined
  ) {
    effective.delayMs = stateDefinition.defaultDelayMs;
  }
  return effective;
}

function applyStoreMutation(mutation) {
  var runtimeStore = plan.stores.user[mutation.store];
  if (!runtimeStore) {
    throw new Error("Unknown generated store mapping: " + mutation.store);
  }

  var store = stores.open(runtimeStore);
  if (mutation.operation === "delete") {
    store.delete(mutation.key);
    return;
  }

  if (mutation.operation === "increment") {
    var delta = mutation.value === undefined ? 1 : Number(mutation.value);
    var nextValue = asNumber(store.load(mutation.key)) + delta;
    store.save(mutation.key, String(nextValue));
    return;
  }

  var value = mutation.value;
  store.save(
    mutation.key,
    typeof value === "string" ? value : JSON.stringify(value)
  );
}

function applyEffects(effects) {
  if (!effects) {
    return null;
  }

  var mutations = effects.stores || [];
  for (var index = 0; index < mutations.length; index += 1) {
    applyStoreMutation(mutations[index]);
  }

  return effects.setState || null;
}

function applyResponse(behavior) {
  var response = respond();

  if (behavior.status !== undefined) {
    response.withStatusCode(behavior.status);
  }

  var headers = behavior.headers || {};
  Object.keys(headers).forEach(function (name) {
    response.withHeader(name, String(headers[name]));
  });

  if (behavior.contentType) {
    response.withHeader("Content-Type", behavior.contentType);
  }

  if (behavior.body) {
    response.withFile(behavior.body);
  } else if (!behavior.failure) {
    response.withEmpty();
  }

  if (behavior.delayMs !== undefined) {
    response.withDelay(behavior.delayMs);
  }

  if (behavior.failure) {
    response.withFailure(behavior.failure);
  }
}

var stateStore = stores.open(plan.stores.state);
var counterStore = stores.open(plan.stores.counters);
var sequenceStore = stores.open(plan.stores.sequences);
var currentState = stateStore.load("currentState") || plan.initialState;
var currentStateCount = asNumber(counterStore.load(currentState)) + 1;
counterStore.save(currentState, String(currentStateCount));

var selected = selectSequence(sequenceStore);
var stateDefinition = plan.states[currentState] || plan.states[plan.initialState];
var effectiveBehavior = applyState(selected.behavior, stateDefinition);
var explicitState = applyEffects(plan.effects);
var stepState = applyEffects(selected.effects);
if (stepState) {
  explicitState = stepState;
}

var nextState = explicitState;
if (!nextState) {
  for (var transitionIndex = 0; transitionIndex < plan.transitions.length; transitionIndex += 1) {
    var transition = plan.transitions[transitionIndex];
    if (
      transition.from === currentState &&
      currentStateCount >= transition.requestCountAtLeast
    ) {
      nextState = transition.to;
      break;
    }
  }
}

if (nextState && nextState !== currentState) {
  stateStore.save("currentState", nextState);
  if (!counterStore.hasItemWithKey(nextState)) {
    counterStore.save(nextState, "0");
  }
}

var correlationId =
  context.request.headers["X-Testy-Correlation-ID"] ||
  context.request.normalisedHeaders["x-testy-correlation-id"] ||
  "none";

logger.info(
  "TESTY_STATE vendor=" + plan.vendorId +
  " operation=" + plan.operationId +
  " case=" + plan.caseId +
  " correlation=" + correlationId +
  " state=" + currentState +
  " nextState=" + (nextState || currentState) +
  " stateRequestCount=" + currentStateCount +
  " sequenceIndex=" + (selected.index === null ? "none" : selected.index)
);

applyResponse(effectiveBehavior);
`;
}

function normalizeResponse(response: ResponseDefinition): ScriptResponse {
  return {
    status: response.status,
    ...(response.headers ? { headers: response.headers } : {}),
    ...(response.contentType ? { contentType: response.contentType } : {}),
    ...(response.body ? { body: response.body } : {}),
    ...(response.delay ? { delayMs: parseDuration(response.delay) } : {}),
  };
}

function normalizeTransport(
  transport: TransportFaultDefinition,
): ScriptResponse {
  switch (transport.type) {
    case "timeout":
      return {
        status: 504,
        delayMs: parseDuration(transport.duration ?? "30s"),
        failure: "CloseConnection",
      };
    case "connection-close":
      return { status: 500, failure: "CloseConnection" };
    case "connection-reset":
      throw new Error(
        "connection-reset cannot be rendered because Imposter does not expose a distinct reset failure.",
      );
  }
}

function normalizeEffects(
  effects: CaseEffectsDefinition,
  stores: StatefulStoreLayout,
): ScriptEffects {
  return {
    ...(effects.setState ? { setState: effects.setState } : {}),
    ...(effects.stores
      ? {
          stores: effects.stores.map((mutation) =>
            normalizeMutation(mutation, stores),
          ),
        }
      : {}),
  };
}

function normalizeMutation(
  mutation: StoreMutationDefinition,
  stores: StatefulStoreLayout,
): NonNullable<ScriptEffects["stores"]>[number] {
  if (!stores.user[mutation.store]) {
    throw new Error(`Store '${mutation.store}' was not included in the generated layout.`);
  }

  return {
    store: mutation.store,
    key: mutation.key,
    operation: mutation.operation,
    ...(mutation.value !== undefined ? { value: mutation.value } : {}),
  };
}

function collectUserStoreIds(model: VendorExecutionModel): readonly string[] {
  const storeIds = new Set<string>();

  for (const operation of model.operations) {
    for (const operationCase of operation.cases) {
      addEffectStores(operationCase.effects, storeIds);
      for (const step of operationCase.sequence?.steps ?? []) {
        addEffectStores(step.effects, storeIds);
      }
    }
  }

  return [...storeIds].sort();
}

function addEffectStores(
  effects: CaseEffectsDefinition | undefined,
  storeIds: Set<string>,
): void {
  for (const mutation of effects?.stores ?? []) {
    storeIds.add(mutation.store);
  }
}

function sanitizeStoreSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return (sanitized || "default").slice(0, 48);
}

function parseDuration(value: string): number {
  const match = /^(\d+)(ms|s|m)$/u.exec(value);
  if (!match) {
    throw new Error(`Invalid duration '${value}'.`);
  }

  const amount = Number(match[1]);
  switch (match[2]) {
    case "ms":
      return amount;
    case "s":
      return amount * 1_000;
    case "m":
      return amount * 60_000;
    default:
      throw new Error(`Unsupported duration unit in '${value}'.`);
  }
}
