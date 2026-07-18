import { readFile } from "node:fs/promises";

import type { AnySchema, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

import { ScenarioValidationError } from "./errors.js";
import type { ScenarioConfig } from "./types.js";

const SCHEMA_ID =
  "https://testy-mctestface.dev/schemas/scenario/v1/scenario.schema.json";
let validatorPromise: Promise<ValidateFunction<ScenarioConfig>> | undefined;

export async function loadScenarioConfig(filePath: string): Promise<ScenarioConfig> {
  const content = await readFile(filePath, "utf8");
  const document = parseDocument(content, {
    merge: false,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new ScenarioValidationError(
      document.errors.map((error) => `${filePath}: ${error.message}`),
    );
  }
  return validateScenarioConfig(document.toJS({ maxAliasCount: 0 }));
}

export async function validateScenarioConfig(value: unknown): Promise<ScenarioConfig> {
  const validator = await (validatorPromise ??= createValidator());
  if (!validator(value)) {
    throw new ScenarioValidationError(
      (validator.errors ?? []).map(
        (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
      ),
    );
  }
  return value;
}

async function createValidator(): Promise<ValidateFunction<ScenarioConfig>> {
  const content = await readFile(
    new URL("../schemas/v1/scenario.schema.json", import.meta.url),
    "utf8",
  );
  const schema = JSON.parse(content) as AnySchema;
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true });
  ajv.addSchema(schema);
  const validator = ajv.getSchema<ScenarioConfig>(SCHEMA_ID);
  if (!validator) throw new Error(`Scenario schema was not registered: ${SCHEMA_ID}`);
  return validator;
}
