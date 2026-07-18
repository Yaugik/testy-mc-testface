import { startReferenceSut } from "./index.js";

const token = process.env.TESTY_REFERENCE_SUT_TOKEN ?? "reference-sut-token-local";
const host = process.env.TESTY_REFERENCE_SUT_HOST ?? "0.0.0.0";
const port = parsePort(process.env.TESTY_REFERENCE_SUT_PORT);
const publicOrigin = process.env.TESTY_REFERENCE_SUT_PUBLIC_ORIGIN;
const mutations = {
  leakToControlTenant: enabled("TESTY_REFERENCE_MUTATE_TENANT_ISOLATION"),
  duplicateScores: enabled("TESTY_REFERENCE_MUTATE_IDEMPOTENCY"),
  skipEnrichment: enabled("TESTY_REFERENCE_MUTATE_ENRICHMENT"),
};

const binding = await startReferenceSut({
  authToken: token,
  host,
  port,
  ...(publicOrigin ? { publicOrigin } : {}),
  mutations,
});

process.stdout.write(`Reference SUT listening on ${binding.origin}\n`);
let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await binding.stop();
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

function parsePort(value: string | undefined): number {
  const selected = Number(value ?? "8080");
  if (!Number.isInteger(selected) || selected < 1 || selected > 65535) {
    throw new Error("TESTY_REFERENCE_SUT_PORT must be an integer between 1 and 65535.");
  }
  return selected;
}

function enabled(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}
