import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runImposterCapabilitySpike } from "../src/index.js";

const runContractTests = process.env.RUN_IMPOSTER_SPIKE === "1";

describe.skipIf(!runContractTests)("Imposter runtime contract", () => {
  it("starts, matches path and headers, captures a safe ledger, and cleans up", async () => {
    const configDirectory = resolve(
      process.cwd(),
      "../../infrastructure/imposter/spike",
    );
    const result = await runImposterCapabilitySpike(configDirectory);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ company: { name: "Nordlicht Example GmbH" } });
    expect(result.ledger.matchedCase).toBe("corporate-ip");
    expect(result.ledger.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  }, 30_000);
});
