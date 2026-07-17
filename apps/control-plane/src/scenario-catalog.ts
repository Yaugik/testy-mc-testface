import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  loadScenarioConfig,
  resolveScenario,
  type ResolvedScenario,
} from "@testy/scenario-engine";

export interface ScenarioCatalog {
  list(): Promise<readonly ResolvedScenario[]>;
  get(scenarioId: string): Promise<ResolvedScenario | undefined>;
}

export class FileScenarioCatalog implements ScenarioCatalog {
  public constructor(private readonly directory: string) {}

  public async list(): Promise<readonly ResolvedScenario[]> {
    const root = resolve(this.directory);
    const names = (await readdir(root))
      .filter((name) => /\.ya?ml$/u.test(name))
      .sort();
    const scenarios = await Promise.all(
      names.map(async (name) => resolveScenario(await loadScenarioConfig(join(root, name)))),
    );
    const seen = new Set<string>();
    for (const scenario of scenarios) {
      if (seen.has(scenario.scenarioId)) {
        throw new Error(`Duplicate scenario ID '${scenario.scenarioId}' in '${root}'.`);
      }
      seen.add(scenario.scenarioId);
    }
    return scenarios;
  }

  public async get(scenarioId: string): Promise<ResolvedScenario | undefined> {
    return (await this.list()).find((scenario) => scenario.scenarioId === scenarioId);
  }
}

export const emptyScenarioCatalog: ScenarioCatalog = {
  async list(): Promise<readonly ResolvedScenario[]> {
    return [];
  },
  async get(): Promise<ResolvedScenario | undefined> {
    return undefined;
  },
};
