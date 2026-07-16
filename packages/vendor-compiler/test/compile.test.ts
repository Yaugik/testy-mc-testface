import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { loadVendorPackage } from "@testy/config-loader";
import { describe, expect, it } from "vitest";

import { compileVendorBundle } from "../src/compile.js";
import { writeVendorBundle } from "../src/writer.js";

const fixturePath = resolve(import.meta.dirname, "../../../vendors/ipinfo");

describe("compileVendorBundle", () => {
  it("compiles stateful IPinfo behavior into deterministic Imposter resources", async () => {
    const loaded = await loadVendorPackage(fixturePath);
    const options = {
      runtimeImage:
        "outofcoffee/imposter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runNamespace: "test-run",
    };
    const first = compileVendorBundle(loaded, options);
    const second = compileVendorBundle(loaded, options);

    expect(second.bundleId).toBe(first.bundleId);
    expect(second.files.map((file) => file.sha256)).toEqual(
      first.files.map((file) => file.sha256),
    );

    const resources = first.imposterConfig.resources as readonly Record<string, unknown>[];
    expect(resources[0]).toMatchObject({
      method: "GET",
      path: "/system/status",
      security: { default: "Permit" },
    });
    expect(resources[1]).toMatchObject({
      path: "/system/store/*",
      security: { default: "Permit" },
    });

    const corporate = resources.find((resource) =>
      String(resource.log).includes("case=corporate-high-confidence"),
    );
    expect(corporate).toMatchObject({
      method: "GET",
      path: "/ipinfo/{ip}",
      pathParams: { ip: "198.51.100.10" },
      response: {
        scriptFile: "generated/lookup-ip--corporate-high-confidence.js",
      },
    });

    const recoveryScript = first.files.find(
      (file) =>
        file.relativePath ===
        "imposter/generated/lookup-ip--transient-recovery.js",
    );
    expect(recoveryScript?.content.toString("utf8")).toContain(
      '"onExhausted":"repeat-last"',
    );
    expect(recoveryScript?.content.toString("utf8")).toContain(
      'response.withFailure(behavior.failure)',
    );

    const system = first.imposterConfig.system as {
      stores: Readonly<Record<string, { preloadData: Readonly<Record<string, unknown>> }>>;
    };
    const stateStoreName = first.manifest.state.stores?.state;
    expect(stateStoreName).toBeDefined();
    expect(system.stores[stateStoreName as string]?.preloadData).toEqual({
      currentState: "healthy",
    });

    expect(first.manifest.capabilities.stateTransitions).toBe("scripted-store");
    expect(first.manifest.capabilities.responseSequences).toBe("scripted-store");
    expect(first.manifest.capabilities.storeMutations).toBe("scripted-store");
    expect(first.manifest.warnings.some((warning) => warning.code === "timeout-approximated")).toBe(true);
  });

  it("writes a self-contained stateful bundle directory", async () => {
    const loaded = await loadVendorPackage(fixturePath);
    const bundle = compileVendorBundle(loaded);
    const outputRoot = await mkdtemp(join(tmpdir(), "testy-compiler-"));

    try {
      const written = await writeVendorBundle(bundle, outputRoot);
      const manifest = JSON.parse(await readFile(written.manifestPath, "utf8")) as {
        bundleId: string;
      };
      const config = JSON.parse(
        await readFile(join(written.configDirectory, "vendor-config.json"), "utf8"),
      ) as { plugin: string };
      const generatedScript = await readFile(
        join(
          written.configDirectory,
          "generated/lookup-ip--transient-recovery.js",
        ),
        "utf8",
      );
      const corporate = JSON.parse(
        await readFile(join(written.configDirectory, "responses/corporate.json"), "utf8"),
      ) as { company: { name: string } };

      expect(manifest.bundleId).toBe(bundle.bundleId);
      expect(config.plugin).toBe("rest");
      expect(generatedScript).toContain("TESTY_STATE");
      expect(corporate.company.name).toBe("Nordlicht Example GmbH");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});
