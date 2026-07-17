import { randomUUID } from "node:crypto";

import type { ResourceLease, RunId, RunStatus, SanitizedError, ScenarioId } from "@testy/shared-types";

import {
  ScenarioCancelledError,
  ScenarioTimeoutError,
  sanitizeScenarioError,
} from "./errors.js";
import { hashCanonical } from "./hash.js";
import { RunStateMachine } from "./state-machine.js";
import type {
  ScenarioCondition,
  PollStep,
  ResolvedScenario,
  ResolvedScenarioStep,
  RetryPolicy,
  ScenarioActionContext,
  ScenarioActionRegistry,
  ScenarioExecutionObserver,
  ScenarioExecutionOptions,
  ScenarioExecutionReport,
  ScenarioValue,
  TaskStep,
} from "./types.js";

interface CleanupEntry {
  readonly name: string;
  readonly cleanup: () => Promise<void>;
  readonly leaseId?: string;
}

interface CompensationEntry {
  readonly stepId: string;
  readonly action: string;
  readonly input?: ScenarioValue;
}

const phaseOrder = [
  ["ALLOCATING", "allocate"],
  ["COMPILING", "compile"],
  ["CONFIGURING", "configure"],
  ["RUNNING", "run"],
  ["OBSERVING", "observe"],
  ["ASSERTING", "assert"],
] as const;

export async function executeScenario(
  scenario: ResolvedScenario,
  actions: ScenarioActionRegistry,
  options: ScenarioExecutionOptions,
): Promise<ScenarioExecutionReport> {
  const startedAt = new Date().toISOString();
  const observer = options.observer ?? noopObserver;
  const state = new RunStateMachine();
  const outputs: Record<string, ScenarioValue> = {};
  const attemptCounters: Record<string, number> = {};
  const cleanups: CleanupEntry[] = [];
  const compensations: CompensationEntry[] = [];
  const controller = new AbortController();
  const detachParent = forwardAbort(options.signal, controller);
  const timer = setTimeout(
    () => controller.abort(new ScenarioTimeoutError(`Scenario exceeded ${scenario.timeoutMs}ms.`)),
    scenario.timeoutMs,
  );
  let outcome: "PASSED" | "FAILED" | "CANCELLED" = "PASSED";
  let executionError: unknown;
  const scenarioId = scenario.scenarioId as ScenarioId;

  const transition = async (status: RunStatus): Promise<void> => {
    state.transition(status);
    await observer.onStatus(status);
    await observer.onTimeline({
      runId: options.runId,
      occurredAt: new Date().toISOString(),
      category: "lifecycle",
      name: status.toLowerCase(),
      metadata: {},
    });
  };

  try {
    await transition("VALIDATING");
    for (const [status, phase] of phaseOrder) {
      throwIfAborted(controller.signal);
      await transition(status);
      await executeSteps(
        scenario.phases[phase],
        status,
        scenario,
        actions,
        options.runId,
        scenarioId,
        controller.signal,
        observer,
        outputs,
        attemptCounters,
        cleanups,
        compensations,
      );
    }
    await transition("PASSED");
  } catch (error) {
    executionError = error;
    if (isCancellation(error, controller.signal)) {
      outcome = "CANCELLED";
      if (state.status !== "CANCELLING") await transition("CANCELLING");
      await transition("CANCELLED");
    } else {
      outcome = "FAILED";
      if (state.status !== "FAILED") await transition("FAILED");
    }
  } finally {
    clearTimeout(timer);
    detachParent();
  }

  const cleanupErrors: SanitizedError[] = [];
  const cleanupController = new AbortController();
  try {
    await transition("CLEANUP");
    if (outcome !== "PASSED") {
      for (const compensation of [...compensations].reverse()) {
        try {
          await invokeAction(
            compensation.action,
            compensation.input,
            actions,
            actionContext(
              options.runId,
              scenarioId,
              scenario,
              cleanupController.signal,
              outputs,
              cleanups,
              observer,
            ),
            undefined,
          );
          await observer.onTimeline({
            runId: options.runId,
            occurredAt: new Date().toISOString(),
            category: "cleanup",
            name: "compensation-passed",
            metadata: { stepId: compensation.stepId, action: compensation.action },
          });
        } catch (error) {
          cleanupErrors.push(sanitizeScenarioError(error));
        }
      }
    }
    for (const entry of [...cleanups].reverse()) {
      try {
        await entry.cleanup();
        if (entry.leaseId) {
          await observer.onResourceReleased?.(entry.leaseId, new Date().toISOString());
        }
        await observer.onTimeline({
          runId: options.runId,
          occurredAt: new Date().toISOString(),
          category: "cleanup",
          name: "cleanup-passed",
          metadata: { name: entry.name },
        });
      } catch (error) {
        cleanupErrors.push(sanitizeScenarioError(error));
      }
    }
    if (cleanupErrors.length > 0 && outcome === "PASSED") outcome = "FAILED";
    await transition(outcome);
  } catch (error) {
    cleanupErrors.push(sanitizeScenarioError(error));
    outcome = outcome === "CANCELLED" ? "CANCELLED" : "FAILED";
  }

  return {
    schemaVersion: "1.0",
    runId: options.runId,
    scenarioId: scenario.scenarioId,
    contentHash: scenario.contentHash,
    status: outcome,
    startedAt,
    completedAt: new Date().toISOString(),
    outputKeys: Object.keys(outputs).sort(),
    outputFingerprints: Object.fromEntries(
      Object.entries(outputs).map(([key, value]) => [key, hashCanonical(value)]),
    ),
    cleanupErrors,
    ...(executionError ? { error: sanitizeScenarioError(executionError) } : {}),
  };
}

async function executeSteps(
  steps: readonly ResolvedScenarioStep[],
  phase: RunStatus,
  scenario: ResolvedScenario,
  actions: ScenarioActionRegistry,
  runId: RunId,
  scenarioId: ScenarioId,
  signal: AbortSignal,
  observer: ScenarioExecutionObserver,
  outputs: Record<string, ScenarioValue>,
  attemptCounters: Record<string, number>,
  cleanups: CleanupEntry[],
  compensations: CompensationEntry[],
): Promise<void> {
  for (const step of steps) {
    throwIfAborted(signal);
    await executeStep(
      step,
      phase,
      scenario,
      actions,
      runId,
      scenarioId,
      signal,
      observer,
      outputs,
      attemptCounters,
      cleanups,
      compensations,
    );
  }
}

async function executeStep(
  step: ResolvedScenarioStep,
  phase: RunStatus,
  scenario: ResolvedScenario,
  actions: ScenarioActionRegistry,
  runId: RunId,
  scenarioId: ScenarioId,
  signal: AbortSignal,
  observer: ScenarioExecutionObserver,
  outputs: Record<string, ScenarioValue>,
  attemptCounters: Record<string, number>,
  cleanups: CleanupEntry[],
  compensations: CompensationEntry[],
): Promise<void> {
  const execute = async (stepSignal: AbortSignal): Promise<void> => {
    await executeStepCore(
      step,
      phase,
      scenario,
      actions,
      runId,
      scenarioId,
      stepSignal,
      observer,
      outputs,
      attemptCounters,
      cleanups,
      compensations,
    );
  };
  if (step.timeoutMs !== undefined && step.kind !== "task") {
    await runWithTimeout(execute, step.timeoutMs, signal, `Step '${step.id}'`);
    return;
  }
  await execute(signal);
}

async function executeStepCore(
  step: ResolvedScenarioStep,
  phase: RunStatus,
  scenario: ResolvedScenario,
  actions: ScenarioActionRegistry,
  runId: RunId,
  scenarioId: ScenarioId,
  signal: AbortSignal,
  observer: ScenarioExecutionObserver,
  outputs: Record<string, ScenarioValue>,
  attemptCounters: Record<string, number>,
  cleanups: CleanupEntry[],
  compensations: CompensationEntry[],
): Promise<void> {
  switch (step.kind) {
    case "task":
      await executeTask(
        step,
        phase,
        scenario,
        actions,
        runId,
        scenarioId,
        signal,
        observer,
        outputs,
        attemptCounters,
        cleanups,
        compensations,
      );
      return;
    case "poll":
      await executePoll(
        step,
        phase,
        scenario,
        actions,
        runId,
        scenarioId,
        signal,
        observer,
        outputs,
        attemptCounters,
        cleanups,
      );
      return;
    case "parallel": {
      const group = new AbortController();
      const detach = forwardAbort(signal, group);
      try {
        await Promise.all(
          step.steps.map(async (child) => {
            try {
              await executeStep(
                child,
                phase,
                scenario,
                actions,
                runId,
                scenarioId,
                group.signal,
                observer,
                outputs,
                attemptCounters,
                cleanups,
                compensations,
              );
            } catch (error) {
              group.abort(error);
              throw error;
            }
          }),
        );
      } finally {
        detach();
      }
      return;
    }
    case "repeat":
      for (let index = 0; index < step.times; index += 1) {
        await executeSteps(
          step.steps,
          phase,
          scenario,
          actions,
          runId,
          scenarioId,
          signal,
          observer,
          outputs,
          attemptCounters,
          cleanups,
          compensations,
        );
      }
      return;
    case "condition": {
      const selected = conditionMatches(step.when, scenario.variables, outputs)
        ? step.then
        : (step.else ?? []);
      await executeSteps(
        selected,
        phase,
        scenario,
        actions,
        runId,
        scenarioId,
        signal,
        observer,
        outputs,
        attemptCounters,
        cleanups,
        compensations,
      );
      return;
    }
  }
}

async function executeTask(
  step: TaskStep,
  phase: RunStatus,
  scenario: ResolvedScenario,
  actions: ScenarioActionRegistry,
  runId: RunId,
  scenarioId: ScenarioId,
  signal: AbortSignal,
  observer: ScenarioExecutionObserver,
  outputs: Record<string, ScenarioValue>,
  attemptCounters: Record<string, number>,
  cleanups: CleanupEntry[],
  compensations: CompensationEntry[],
): Promise<void> {
  const output = await executeAttemptedAction(
    step.id,
    step.kind,
    step.action,
    step.input,
    step.retry,
    step.timeoutMs,
    phase,
    scenario,
    actions,
    runId,
    scenarioId,
    signal,
    observer,
    outputs,
    attemptCounters,
    cleanups,
  );
  if (output !== undefined) outputs[step.id] = output;
  if (step.compensate) {
    compensations.push({ stepId: step.id, ...step.compensate });
  }
}

async function executePoll(
  step: PollStep,
  phase: RunStatus,
  scenario: ResolvedScenario,
  actions: ScenarioActionRegistry,
  runId: RunId,
  scenarioId: ScenarioId,
  signal: AbortSignal,
  observer: ScenarioExecutionObserver,
  outputs: Record<string, ScenarioValue>,
  attemptCounters: Record<string, number>,
  cleanups: CleanupEntry[],
): Promise<void> {
  const deadline = Date.now() + (step.timeoutMs ?? scenario.timeoutMs);
  while (Date.now() <= deadline) {
    const output = await executeAttemptedAction(
      step.id,
      step.kind,
      step.action,
      step.input,
      step.retry,
      undefined,
      phase,
      scenario,
      actions,
      runId,
      scenarioId,
      signal,
      observer,
      outputs,
      attemptCounters,
      cleanups,
    );
    if (output !== undefined) outputs[step.id] = output;
    if (conditionMatches(step.until, scenario.variables, outputs, output)) return;
    await abortableDelay(step.intervalMs, signal);
  }
  throw new ScenarioTimeoutError(`Poll step '${step.id}' exceeded its timeout.`);
}

async function executeAttemptedAction(
  stepId: string,
  kind: ResolvedScenarioStep["kind"],
  action: string,
  input: ScenarioValue | undefined,
  retry: RetryPolicy | undefined,
  timeoutMs: number | undefined,
  phase: RunStatus,
  scenario: ResolvedScenario,
  actions: ScenarioActionRegistry,
  runId: RunId,
  scenarioId: ScenarioId,
  signal: AbortSignal,
  observer: ScenarioExecutionObserver,
  outputs: Record<string, ScenarioValue>,
  attemptCounters: Record<string, number>,
  cleanups: CleanupEntry[],
): Promise<ScenarioValue | undefined> {
  const attempts = retry?.attempts ?? 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    throwIfAborted(signal);
    const actualAttempt = (attemptCounters[stepId] ?? 0) + 1;
    attemptCounters[stepId] = actualAttempt;
    const started = new Date();
    await observer.onStep({
      runId,
      stepId,
      kind,
      phase,
      status: "RUNNING",
      attempt: actualAttempt,
      startedAt: started.toISOString(),
    });
    try {
      const context = actionContext(
        runId,
        scenarioId,
        scenario,
        signal,
        outputs,
        cleanups,
        observer,
      );
      const output = await invokeAction(action, input, actions, context, timeoutMs);
      const completed = new Date();
      await observer.onStep({
        runId,
        stepId,
        kind,
        phase,
        status: "PASSED",
        attempt: actualAttempt,
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        durationMs: completed.getTime() - started.getTime(),
        ...(output !== undefined ? { outputFingerprint: hashCanonical(output) } : {}),
      });
      return output;
    } catch (error) {
      lastError = error;
      const completed = new Date();
      const cancelled = isCancellation(error, signal);
      await observer.onStep({
        runId,
        stepId,
        kind,
        phase,
        status: cancelled ? "CANCELLED" : "FAILED",
        attempt: actualAttempt,
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        durationMs: completed.getTime() - started.getTime(),
        error: sanitizeScenarioError(error),
      });
      if (cancelled || attempt >= attempts) throw error;
      const delayMs = retry?.delayMs ?? 0;
      const factor = retry?.backoffFactor ?? 1;
      await abortableDelay(Math.round(delayMs * factor ** (attempt - 1)), signal);
    }
  }
  throw lastError ?? new Error(`Scenario action '${action}' failed.`);
}

async function invokeAction(
  name: string,
  input: ScenarioValue | undefined,
  actions: ScenarioActionRegistry,
  context: ScenarioActionContext,
  timeoutMs: number | undefined,
): Promise<ScenarioValue | undefined> {
  const handler = actions[name];
  if (!handler) throw new Error(`Scenario action '${name}' is not registered.`);
  if (timeoutMs === undefined) {
    return raceWithAbort(handler(input, context), context.signal);
  }
  return runWithTimeout(
    async (signal) => handler(input, { ...context, signal }),
    timeoutMs,
    context.signal,
    `Action '${name}'`,
  );
}

async function runWithTimeout<Value>(
  operation: (signal: AbortSignal) => Promise<Value>,
  timeoutMs: number,
  parentSignal: AbortSignal,
  label: string,
): Promise<Value> {
  const controller = new AbortController();
  const detach = forwardAbort(parentSignal, controller);
  const timer = setTimeout(
    () => controller.abort(new ScenarioTimeoutError(`${label} exceeded ${timeoutMs}ms.`)),
    timeoutMs,
  );
  try {
    return await raceWithAbort(operation(controller.signal), controller.signal);
  } finally {
    clearTimeout(timer);
    detach();
  }
}

async function raceWithAbort<Value>(
  operation: Promise<Value>,
  signal: AbortSignal,
): Promise<Value> {
  throwIfAborted(signal);
  return new Promise<Value>((resolveOperation, rejectOperation) => {
    const abort = (): void => {
      signal.removeEventListener("abort", abort);
      rejectOperation(
        signal.reason instanceof Error ? signal.reason : new ScenarioCancelledError(),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolveOperation(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        rejectOperation(error);
      },
    );
  });
}

function actionContext(
  runId: RunId,
  scenarioId: ScenarioId,
  scenario: ResolvedScenario,
  signal: AbortSignal,
  outputs: Readonly<Record<string, ScenarioValue>>,
  cleanups: CleanupEntry[],
  observer: ScenarioExecutionObserver,
): ScenarioActionContext {
  return {
    runId,
    scenarioId,
    target: scenario.target,
    variables: scenario.variables,
    outputs,
    signal,
    registerCleanup(name, cleanup) {
      cleanups.push({ name, cleanup });
    },
    async registerResourceLease(resourceType, resourceKey, expiresAt, cleanup) {
      const lease: ResourceLease = {
        leaseId: randomUUID(),
        runId,
        resourceType,
        resourceKey,
        expiresAt,
      };
      await observer.onResourceLease?.(lease);
      cleanups.push({
        name: `lease:${resourceType}:${resourceKey}`,
        cleanup,
        leaseId: lease.leaseId,
      });
      return lease;
    },
  };
}

function conditionMatches(
  condition: ScenarioCondition,
  variables: Readonly<Record<string, ScenarioValue>>,
  outputs: Readonly<Record<string, ScenarioValue>>,
  current?: ScenarioValue,
): boolean {
  const root: unknown = condition.path === "$" ? current : { variables, outputs };
  const actual = condition.path === "$" ? root : readPath(root, condition.path);
  return JSON.stringify(actual) === JSON.stringify(condition.equals);
}

function readPath(root: unknown, path: string): unknown {
  const normalized = path.replace(/^\$\.?/u, "");
  if (!normalized) return root;
  let current = root;
  for (const segment of normalized.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current;
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return (
    error instanceof ScenarioCancelledError ||
    (signal.aborted && !(signal.reason instanceof ScenarioTimeoutError))
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof ScenarioTimeoutError) throw signal.reason;
  if (signal.reason instanceof Error) throw new ScenarioCancelledError(signal.reason.message);
  throw new ScenarioCancelledError();
}

function forwardAbort(parent: AbortSignal | undefined, child: AbortController): () => void {
  if (!parent) return () => undefined;
  const abort = (): void => child.abort(parent.reason);
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  return () => parent.removeEventListener("abort", abort);
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (milliseconds <= 0) {
    throwIfAborted(signal);
    return;
  }
  await new Promise<void>((resolveDelay, rejectDelay) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolveDelay();
    }, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      rejectDelay(
        signal.reason instanceof Error ? signal.reason : new ScenarioCancelledError(),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

const noopObserver: ScenarioExecutionObserver = {
  async onStatus(): Promise<void> {},
  async onStep(): Promise<void> {},
  async onTimeline(): Promise<void> {},
};
