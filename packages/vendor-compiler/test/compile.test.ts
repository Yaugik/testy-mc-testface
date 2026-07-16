import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { loadVendorPackage } from "@testy/config-loader";
import { describe, expect, it } from "vitest";

import { compileVendorBundle } from "../src/compile.js";
import { writeVendorBundle } from "../src/writer.js";

const fixturePath = resolve(import.meta.dirname, "../../../vendors/ipinfo");

describe("compileVendorBundle", () => {
  it("compiles the IPinfo package into deterministic Imposter resources", async () => {
    const loaded = await loadVendorPackage(fixturePath);
    const first = compileVendorBundle(loaded, {
      runtimeImage: "outofcoffee/imposter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runNamespace: "test-run",
    });
    const second = compileVendorBundle(loaded, {
      runtimeImage: "outofcoffee/imposter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runNamespace: "test-run",
    });

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

    const corporate = resources.find((resource) =>
      String(resource.log).includes("case=corporate-high-confidence"),
    );
    expect(corporate).toMatchObject({
      method: "GET",
      path: "/ipinfo/{ip}",
      pathParams: { ip: "198.51.100.10" },
      response: {
        statusCode: 200,
        file: "responses/corporate.json",
      },
    });

    const timeout = resources.find((resource) =>
      String(resource.log).includes("case=timeout"),
    );
    expect(timeout).toMatchObject({
      response: {
        delay: { exact: 5000 },
        fail: "CloseConnection",
      },
    });

    expect(first.sourceMap.entries.some((entry) => entry.caseId === "residential")).toBe(true);
    expect(first.manifest.capabilities.stateTransitions).toBe("declared-not-active");
    expect(first.manifest.warnings.some((warning) => warning.code === "timeout-approximated")).toBe(true);
  });

  it("writes a self-contained bundle directory", async () => {
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
      const corporate = JSON.parse(
        await readFile(join(written.configDirectory, "responses/corporate.json"), "utf8"),
      ) as { company: { name: string } };

      expect(manifest.bundleId).toBe(bundle.bundleId);
      expect(config.plugin).toBe("rest");
      expect(corporate.company.name).toBe("Nordlicht Example GmbH");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});
