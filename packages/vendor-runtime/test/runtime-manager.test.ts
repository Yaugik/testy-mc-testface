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
  public resolveCalls = 0;

  public async run(spec: ContainerRunSpec): Promise<{ readonly id: string }> {
    this.runSpec = spec;
    return { id: "container-1" };
  }

  public async resolveHostPort(): Promise<number> {
    this.resolveCalls += 1;
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
    state: {
      initialState: "healthy",
      stores: {
        state: "testy_state",
        counters: "testy_counters",
        sequences: "testy_sequences",
        user: { recovery: "testy_recovery" },
      },
    },
  },
} as unknown as WrittenVendorBundle;

describe("ImposterRuntimeManager", () => {
  it("waits for readiness and stops idempotently", async () => {
    const engine = new FakeContainerEngine();
    let requests = 0;
    const fetcher = (async () => {
      requests += 1;
      if (requests < 2) return new Response("not ready", { status: 503 });
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
    expect(engine.resolveCalls).toBe(1);

    await runtime.stop();
    await runtime.stop();
    expect(engine.removed).toEqual(["container-1"]);
  });

  it("uses container DNS without publishing a host port on a private network", async () => {
    const engine = new FakeContainerEngine();
    const fetcher = (async (input: string | URL | Request) => {
      expect(String(input)).toBe("http://testy-run-ipinfo:8080/system/status");
      return Response.json({ status: "ok", version: "5.x" });
    }) as typeof fetch;

    const runtime = await new ImposterRuntimeManager(engine, fetcher).start(bundle, {
      containerName: "testy-run-ipinfo",
      networkName: "testy-platform",
    });

    expect(runtime.baseUrl).toBe("http://testy-run-ipinfo:8080");
    expect(runtime.providerBaseUrl).toBe("http://testy-run-ipinfo:8080/ipinfo");
    expect(engine.runSpec?.networkName).toBe("testy-platform");
    expect(engine.runSpec?.ports).toEqual([]);
    expect(engine.resolveCalls).toBe(0);
  });

  it("reads and resets generated runtime stores", async () => {
    const engine = new FakeContainerEngine();
    const stores = new Map<string, Record<string, unknown>>([
      ["testy_state", { currentState: "unavailable" }],
      ["testy_counters", { unavailable: "3" }],
      ["testy_sequences", { "lookup-ip.transient-recovery": "2" }],
      ["testy_recovery", { attempts: "2" }],
    ]);

    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/system/status") return Response.json({ status: "ok" });

      const prefix = "/system/store/";
      const storeName = decodeURIComponent(url.pathname.slice(prefix.length));
      const method = init?.method ?? "GET";
      if (method === "DELETE") {
        stores.delete(storeName);
        return new Response(null, { status: 204 });
      }
      if (method === "POST") {
        stores.set(
          storeName,
          JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        );
        return new Response(null, { status: 204 });
      }

      const data = stores.get(storeName);
      return data
        ? Response.json(data)
        : new Response("missing", { status: 404 });
    }) as typeof fetch;

    const runtime = await new ImposterRuntimeManager(engine, fetcher).start(bundle);
    await expect(runtime.stateSnapshot()).resolves.toEqual({
      currentState: "unavailable",
      state: { currentState: "unavailable" },
      counters: { unavailable: "3" },
      sequences: { "lookup-ip.transient-recovery": "2" },
      user: { recovery: { attempts: "2" } },
    });

    await runtime.resetState();
    await expect(runtime.stateSnapshot()).resolves.toEqual({
      currentState: "healthy",
      state: { currentState: "healthy" },
      counters: {},
      sequences: {},
      user: { recovery: {} },
    });
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
