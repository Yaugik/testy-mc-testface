import { hashCanonical } from "./hash.js";
import { ScenarioValidationError } from "./errors.js";
import type {
  FragmentStep,
  ResolvedConditionStep,
  ResolvedParallelStep,
  ResolvedRepeatStep,
  ResolvedScenario,
  ResolvedScenarioStep,
  ScenarioConfig,
  ScenarioStepDefinition,
  ScenarioValue,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

export function resolveScenario(config: ScenarioConfig): ResolvedScenario {
  const issues: string[] = [];
  const fragments = config.fragments ?? {};
  validateUniqueStepIds(config, issues);
  validateFragmentReferences(config, issues);
  validateUniqueAssertionIds(config, issues);
  validateAssertions(config, issues);
  if (issues.length > 0) {
    throw new ScenarioValidationError(issues);
  }

  const variables = config.variables ?? {};
  const assertions = substituteValue(config.assertions ?? [], variables) as NonNullable<
    ScenarioConfig["assertions"]
  >;
  const authoredAssertSteps = expand(config.phases.assert ?? [], fragments, variables);
  const phases = {
    allocate: expand(config.phases.allocate ?? [], fragments, variables),
    compile: expand(config.phases.compile ?? [], fragments, variables),
    configure: expand(config.phases.configure ?? [], fragments, variables),
    run: expand(config.phases.run, fragments, variables),
    observe: expand(config.phases.observe ?? [], fragments, variables),
    assert: [
      ...authoredAssertSteps,
      ...(assertions.length === 0
        ? []
        : [
            {
              id: "system-assertions",
              kind: "task" as const,
              action: "assertions-evaluate",
              input: assertions as unknown as ScenarioValue,
            },
          ]),
    ],
  };
  const materialized = {
    schemaVersion: "1.0" as const,
    scenarioId: config.scenario.id,
    displayName: config.scenario.displayName,
    target: config.target,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    variables,
    phases,
    assertions,
  };

  return {
    ...materialized,
    contentHash: hashCanonical(materialized),
  };
}

function expand(
  steps: readonly ScenarioStepDefinition[],
  fragments: Readonly<Record<string, readonly ScenarioStepDefinition[]>>,
  variables: Readonly<Record<string, ScenarioValue>>,
  stack: readonly string[] = [],
  prefix = "",
): ResolvedScenarioStep[] {
  const result: ResolvedScenarioStep[] = [];
  for (const step of steps) {
    const nextId = prefix ? `${prefix}.${step.id}` : step.id;
    if (step.kind === "fragment") {
      if (stack.includes(step.useFragment)) {
        throw new ScenarioValidationError([
          `Scenario fragment cycle: ${[...stack, step.useFragment].join(" -> ")}.`,
        ]);
      }
      const fragment = fragments[step.useFragment];
      if (!fragment) {
        throw new ScenarioValidationError([
          `Step '${step.id}' references unknown fragment '${step.useFragment}'.`,
        ]);
      }
      result.push(
        ...expand(fragment, fragments, variables, [...stack, step.useFragment], nextId),
      );
      continue;
    }
    result.push(resolveStep(step, nextId, fragments, variables, stack));
  }
  return result;
}

function resolveStep(
  step: Exclude<ScenarioStepDefinition, FragmentStep>,
  id: string,
  fragments: Readonly<Record<string, readonly ScenarioStepDefinition[]>>,
  variables: Readonly<Record<string, ScenarioValue>>,
  stack: readonly string[],
): ResolvedScenarioStep {
  const mapped = substituteValue(step, variables) as Exclude<
    ScenarioStepDefinition,
    FragmentStep
  >;
  switch (mapped.kind) {
    case "parallel":
      return {
        ...mapped,
        id,
        steps: expand(mapped.steps, fragments, variables, stack, id),
      } as ResolvedParallelStep;
    case "repeat":
      return {
        ...mapped,
        id,
        steps: expand(mapped.steps, fragments, variables, stack, id),
      } as ResolvedRepeatStep;
    case "condition":
      return {
        ...mapped,
        id,
        then: expand(mapped.then, fragments, variables, stack, `${id}.then`),
        ...(mapped.else
          ? { else: expand(mapped.else, fragments, variables, stack, `${id}.else`) }
          : {}),
      } as ResolvedConditionStep;
    default:
      return { ...mapped, id };
  }
}

function substituteValue(
  value: unknown,
  variables: Readonly<Record<string, ScenarioValue>>,
): unknown {
  if (typeof value === "string") {
    const exact = /^\{\{([a-zA-Z][a-zA-Z0-9_.-]*)\}\}$/u.exec(value);
    if (exact) {
      const replacement = variables[exact[1] as string];
      if (replacement === undefined) {
        throw new ScenarioValidationError([`Scenario variable '${exact[1]}' is not defined.`]);
      }
      return replacement;
    }
    return value.replace(
      /\{\{([a-zA-Z][a-zA-Z0-9_.-]*)\}\}/gu,
      (_match, name: string) => {
        const replacement = variables[name];
        if (replacement === undefined) {
          throw new ScenarioValidationError([`Scenario variable '${name}' is not defined.`]);
        }
        if (typeof replacement === "object") {
          throw new ScenarioValidationError([
            `Scenario variable '${name}' cannot be interpolated into a string.`,
          ]);
        }
        return String(replacement);
      },
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteValue(item, variables));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteValue(item, variables)]),
    );
  }
  return value;
}

function validateUniqueStepIds(config: ScenarioConfig, issues: string[]): void {
  const seen = new Set<string>();
  const visit = (steps: readonly ScenarioStepDefinition[], label: string): void => {
    for (const step of steps) {
      const key = `${label}:${step.id}`;
      if (seen.has(key)) {
        issues.push(`Duplicate step ID '${step.id}' in ${label}.`);
      }
      seen.add(key);
      if (step.kind === "parallel" || step.kind === "repeat") {
        visit(step.steps, `${label}.${step.id}`);
      } else if (step.kind === "condition") {
        visit(step.then, `${label}.${step.id}.then`);
        if (step.else) visit(step.else, `${label}.${step.id}.else`);
      }
    }
  };
  for (const [phase, steps] of Object.entries(config.phases)) {
    if (steps) visit(steps, `phase '${phase}'`);
  }
  for (const [name, steps] of Object.entries(config.fragments ?? {})) {
    visit(steps, `fragment '${name}'`);
  }
}

function validateFragmentReferences(config: ScenarioConfig, issues: string[]): void {
  const fragments = config.fragments ?? {};
  const visit = (steps: readonly ScenarioStepDefinition[]): void => {
    for (const step of steps) {
      if (step.kind === "fragment" && !fragments[step.useFragment]) {
        issues.push(
          `Step '${step.id}' references unknown fragment '${step.useFragment}'.`,
        );
      } else if (step.kind === "parallel" || step.kind === "repeat") {
        visit(step.steps);
      } else if (step.kind === "condition") {
        visit(step.then);
        if (step.else) visit(step.else);
      }
    }
  };
  for (const steps of Object.values(config.phases)) {
    if (steps) visit(steps);
  }
  for (const steps of Object.values(fragments)) visit(steps);
}

function validateUniqueAssertionIds(config: ScenarioConfig, issues: string[]): void {
  const seen = new Set<string>();
  for (const assertion of config.assertions ?? []) {
    if (seen.has(assertion.id)) {
      issues.push(`Duplicate assertion ID '${assertion.id}'.`);
    }
    seen.add(assertion.id);
  }
}


function validateAssertions(config: ScenarioConfig, issues: string[]): void {
  for (const assertion of config.assertions ?? []) {
    if (
      assertion.type === "provider-call-count" ||
      assertion.type === "observation-count"
    ) {
      if (
        assertion.equals === undefined &&
        assertion.minimum === undefined &&
        assertion.maximum === undefined
      ) {
        issues.push(`Assertion '${assertion.id}' must define equals, minimum, or maximum.`);
      }
      if (
        typeof assertion.minimum === "number" &&
        typeof assertion.maximum === "number" &&
        assertion.minimum > assertion.maximum
      ) {
        issues.push(`Assertion '${assertion.id}' has minimum greater than maximum.`);
      }
    }
    if (
      assertion.type === "observation" &&
      assertion.operator !== "present" &&
      assertion.operator !== "absent" &&
      assertion.expected === undefined
    ) {
      issues.push(`Assertion '${assertion.id}' requires an expected value.`);
    }
  }
}
