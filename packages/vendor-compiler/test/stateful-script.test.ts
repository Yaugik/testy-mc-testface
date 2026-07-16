import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { loadVendorPackage } from "@testy/config-loader";
import { describe, expect, it } from "vitest";

import { compileVendorBundle, type CompiledVendorBundle } from "../src/index.js";

const fixturePath = resolve(import.meta.dirname, "../../../vendors/ipinfo");

interface RecordedResponse {
  statusCode?: number;
  file?: string;
  delayMs?: number;
  failure?: string;
  empty?: boolean;
  headers: Record<string, string>;
}

class FakeStore {
  public constructor(private readonly values: Map<string, unknown>) {}

  public load(key: string): unknown {
    return this.values.get(key);
  }

  public save(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  public delete(key: string): void {
    this.values.delete(key);
  }

  public hasItemWithKey(key: string): boolean {
    return this.values.has(key);
  }

  public snapshot(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this.values);
  }
}

class ResponseBuilder {
  public readonly result: RecordedResponse = { headers: {} };

  public withStatusCode(value: number): this {
    this.result.statusCode = value;
    return this;
  }

  public withHeader(name: string, value: string): this {
    this.result.headers[name] = value;
    return this;
  }

  public withFile(value: string): this {
    this.result.file = value;
    return this;
  }

  public withEmpty(): this {
    this.result.empty = true;
    return this;
  }

  public withDelay(value: number): this {
    this.result.delayMs = value;
    return this;
  }

  public withFailure(value: string): this {
    this.result.failure = value;
    return this;
  }
}

class ScriptHarness {
  private readonly stores = new Map<string, FakeStore>();

  public constructor(private readonly bundle: CompiledVendorBundle) {
    const system = bundle.imposterConfig.system as {
      stores: Readonly<
        Record<string, { preloadData: Readonly<Record<string, unknown>> }>
      >;
    };

    for (const [storeName, definition] of Object.entries(system.stores)) {
      this.stores.set(
        storeName,
        new FakeStore(new Map(Object.entries(definition.preloadData))),
      );
    }
  }

  public runCase(caseId: string): RecordedResponse {
    const resources = this.bundle.imposterConfig.resources as readonly {
      log?: string;
      response?: { scriptFile?: string };
    }[];
    const resource = resources.find((candidate) =>
      candidate.log?.includes(`case=${caseId}`),
    );
    const scriptPath = resource?.response?.scriptFile;
    if (!scriptPath) {
      throw new Error(`Generated script not found for case '${caseId}'.`);
    }

    const file = this.bundle.files.find(
      (candidate) => candidate.relativePath === `imposter/${scriptPath}`,
    );
    if (!file) {
      throw new Error(`Bundle file '${scriptPath}' was not generated.`);
    }

    const response = new ResponseBuilder();
    runInNewContext(file.content.toString("utf8"), {
      stores: {
        open: (storeName: string) => {
          const store = this.stores.get(storeName);
          if (!store) {
            throw new Error(`Store '${storeName}' is not preloaded.`);
          }
          return store;
        },
      },
      respond: () => response,
      context: {
        request: {
          headers: { "X-Testy-Correlation-ID": `test-${caseId}` },
          normalisedHeaders: {
            "x-testy-correlation-id": `test-${caseId}`,
          },
        },
      },
      logger: { info: (_message: string) => undefined },
      console: { log: (_message: string) => undefined },
      JSON,
      Math,
      Number,
      String,
      Object,
      isFinite,
      Error,
    });
    return response.result;
  }

  public store(logicalName: string): Readonly<Record<string, unknown>> {
    const runtimeName = this.bundle.manifest.state.stores?.user[logicalName];
    if (!runtimeName) {
      throw new Error(`Logical store '${logicalName}' is not mapped.`);
    }
    return this.stores.get(runtimeName)?.snapshot() ?? {};
  }

  public currentState(): unknown {
    const runtimeName = this.bundle.manifest.state.stores?.state;
    return runtimeName
      ? this.stores.get(runtimeName)?.snapshot().currentState
      : undefined;
  }
}

describe("generated stateful Imposter scripts", () => {
  it("executes a timeout, failure, recovery, then repeats the recovered result", async () => {
    const loaded = await loadVendorPackage(fixturePath);
    const harness = new ScriptHarness(compileVendorBundle(loaded));

    expect(harness.runCase("transient-recovery")).toMatchObject({
      delayMs: 2000,
      failure: "CloseConnection",
    });
    expect(harness.runCase("transient-recovery")).toMatchObject({
      statusCode: 503,
      file: "responses/unavailable.json",
    });
    expect(harness.runCase("transient-recovery")).toMatchObject({
      statusCode: 200,
      file: "responses/corporate.json",
    });
    expect(harness.runCase("transient-recovery")).toMatchObject({
      statusCode: 200,
      file: "responses/corporate.json",
    });

    expect(harness.store("recovery")).toMatchObject({
      attempts: "4",
      "last-outcome": "recovered",
    });
  });

  it("applies explicit and request-count system-state transitions", async () => {
    const loaded = await loadVendorPackage(fixturePath);
    const harness = new ScriptHarness(compileVendorBundle(loaded));

    expect(harness.runCase("enter-unavailable")).toMatchObject({
      statusCode: 503,
    });
    expect(harness.currentState()).toBe("unavailable");

    for (let request = 0; request < 3; request += 1) {
      expect(harness.runCase("corporate-high-confidence")).toMatchObject({
        statusCode: 503,
        file: "responses/unavailable.json",
      });
    }

    expect(harness.currentState()).toBe("healthy");
    expect(harness.runCase("corporate-high-confidence")).toMatchObject({
      statusCode: 200,
      file: "responses/corporate.json",
    });
    expect(harness.store("scenario")).toMatchObject({
      "last-trigger": "enter-unavailable",
    });
  });
});
