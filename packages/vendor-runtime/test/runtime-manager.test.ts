import type { WrittenVendorBundle } from "@testy/vendor-compiler";
import { describe, expect, it } from "vitest";

import { ImposterRuntimeManager } from "../src/runtime-manager.js";
import type {
  ContainerEngine,
  ContainerRunSpec,
} from "../src/types.js";

class FakeContainerEngine implements ContainerEngine {
  public runSpec: ContainerRunSpec | undefined;
  public readonly removed: string[] = [];
  public logText = "";

  public async run(spec: ContainerRunSpec): Promise<{ readonly id: string }> {
    this.runSpec = spec;
    return { id: "container-1" };
  }

  public async resolveHostPort(): Promise<number> {
    return 49152;
  }

  public async logs(): Promise<string> {
    return this.logText;
  }

  public async remove(containerId: string): Promise<void> {
    this.removed.push(containerId);
  }
}

const bundle = {
  bundleId: "abc123abc123abc123abc123",
  configDirectory: "/tmp/testy-bundle/imposter",
  manifest: {
    vendor: { id: "ipinfo" },
    runtime: { image: "outofcoffee/imposter:5" },
    endpoint: { basePath: "/ipinfo" },
  },
} as unknown as WrittenVendorBundle;

describe("ImposterRuntimeManager", () => {
  it("waits for readiness and stops idempotently", async () => {
    const engine = new FakeContainerEngine();
    let requests = 0;
    const fetcher = (async () => {
      requests += 1;
      if (requests < 2) {
        return new Response("not ready", { status: 503 });
      }
      return Response.json({ status: "ok", version: "5.x" });
    }) as typeof fetch;

    const runtime = await new ImposterRuntimeManager(engine, fetcher).start(bundle, {
      pollIntervalMs: 1,
      startupTimeoutMs: 100,
    });

    expect(runtime.baseUrl).toBe("http://127.0.0.1:49152");
    expect(runtime.providerBaseUrl).toBe("http://127.0.0.1:49152/ipinfo");
    expect(engine.runSpec?.mounts[0]).toMatchObject({
      containerPath: "/opt/imposter/config",
      readOnly: true,
    });

    await runtime.stop();
    await runtime.stop();
    expect(engine.removed).toEqual(["container-1"]);
  });

  it("removes the container when readiness fails", async () => {
    const engine = new FakeContainerEngine();
    const fetcher = (async () => new Response("not ready", { status: 503 })) as typeof fetch;

    await expect(
      new ImposterRuntimeManager(engine, fetcher).start(bundle, {
        pollIntervalMs: 1,
        startupTimeoutMs: 5,
      }),
    ).rejects.toThrow("Unable to start Imposter vendor runtime");
    expect(engine.removed).toEqual(["container-1"]);
  });
});
