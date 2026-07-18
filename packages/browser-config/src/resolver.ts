import { createHash } from "node:crypto";

import type {
  ArtifactPolicy,
  JourneyActionDefinition,
  JourneyConfig,
  LoadedBrowserPackage,
  PersonaConfig,
} from "@testy/browser-schema";

export interface ResolvedJourney {
  readonly customerId: string;
  readonly siteId: string;
  readonly journeyId: string;
  readonly persona: PersonaConfig;
  readonly startPath: string;
  readonly timeoutMs: number;
  readonly variables: Readonly<Record<string, string>>;
  readonly artifactPolicy: ArtifactPolicy;
  readonly networkFixtures: JourneyConfig["networkFixtures"];
  readonly steps: readonly JourneyActionDefinition[];
  readonly contentHash: string;
}

export function resolveJourney(
  loaded: LoadedBrowserPackage,
  journeyId: string,
): ResolvedJourney {
  const journey = loaded.journeys.find((item) => item.journey.id === journeyId);
  if (!journey) throw new Error(`Journey '${journeyId}' was not found.`);
  const persona = loaded.personas.find((item) => item.persona.id === journey.persona);
  if (!persona) throw new Error(`Persona '${journey.persona}' was not found.`);
  const fragments = new Map(
    loaded.fragments.map((item) => [item.fragment.id, item.steps] as const),
  );
  const variables = { ...(loaded.site.variables ?? {}), ...(persona.variables ?? {}) };
  const steps = expandSteps(journey.steps, fragments).map((step) =>
    substituteAction(step, variables),
  );
  const artifactPolicy = {
    ...loaded.customer.artifactPolicy,
    ...(journey.artifactPolicy ?? {}),
  };
  const canonical = JSON.stringify({
    packageHash: loaded.contentHash,
    journeyId,
    persona: persona.persona.id,
    variables,
    artifactPolicy,
    steps,
  });

  return {
    customerId: loaded.customer.customer.id,
    siteId: loaded.site.site.id,
    journeyId,
    persona,
    startPath: substitute(journey.startPath, variables),
    timeoutMs: journey.timeoutMs ?? 60_000,
    variables,
    artifactPolicy,
    networkFixtures: journey.networkFixtures,
    steps,
    contentHash: createHash("sha256").update(canonical).digest("hex"),
  };
}

function expandSteps(
  steps: JourneyConfig["steps"],
  fragments: ReadonlyMap<string, JourneyConfig["steps"]>,
  stack: readonly string[] = [],
): JourneyActionDefinition[] {
  const result: JourneyActionDefinition[] = [];
  for (const step of steps) {
    if (!("useFragment" in step)) {
      result.push(step);
      continue;
    }
    if (stack.includes(step.useFragment)) {
      throw new Error(`Browser fragment cycle: ${[...stack, step.useFragment].join(" -> ")}`);
    }
    const fragment = fragments.get(step.useFragment);
    if (!fragment) throw new Error(`Browser fragment '${step.useFragment}' was not found.`);
    result.push(...expandSteps(fragment, fragments, [...stack, step.useFragment]));
  }
  return result;
}

function substituteAction(
  step: JourneyActionDefinition,
  variables: Readonly<Record<string, string>>,
): JourneyActionDefinition {
  return mapStrings(step, (value) => substitute(value, variables)) as JourneyActionDefinition;
}

function mapStrings(value: unknown, map: (value: string) => string): unknown {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)]),
    );
  }
  return value;
}

function substitute(
  value: string,
  variables: Readonly<Record<string, string>>,
): string {
  return value.replace(/\{\{([a-zA-Z][a-zA-Z0-9_.-]*)\}\}/gu, (_match, name: string) => {
    const replacement = variables[name];
    if (replacement === undefined) throw new Error(`Browser variable '${name}' is not defined.`);
    return replacement;
  });
}
