import { readFile } from "node:fs/promises";

import type { AnySchema, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import {
  BROWSER_SCHEMA_IDS,
  browserSchemaDirectory,
  type CustomerConfig,
  type FragmentConfig,
  type JourneyConfig,
  type PersonaConfig,
  type SiteConfig,
} from "@testy/browser-schema";

export interface BrowserSchemaRegistry {
  readonly customer: ValidateFunction<CustomerConfig>;
  readonly site: ValidateFunction<SiteConfig>;
  readonly persona: ValidateFunction<PersonaConfig>;
  readonly journey: ValidateFunction<JourneyConfig>;
  readonly fragment: ValidateFunction<FragmentConfig>;
}

export async function createBrowserSchemaRegistry(): Promise<BrowserSchemaRegistry> {
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true });
  for (const fileName of [
    "common.schema.json",
    "customer.schema.json",
    "site.schema.json",
    "persona.schema.json",
    "journey.schema.json",
    "fragment.schema.json",
  ]) {
    const content = await readFile(new URL(fileName, browserSchemaDirectory), "utf8");
    ajv.addSchema(JSON.parse(content) as AnySchema);
  }

  return {
    customer: requireValidator(ajv, BROWSER_SCHEMA_IDS.customer),
    site: requireValidator(ajv, BROWSER_SCHEMA_IDS.site),
    persona: requireValidator(ajv, BROWSER_SCHEMA_IDS.persona),
    journey: requireValidator(ajv, BROWSER_SCHEMA_IDS.journey),
    fragment: requireValidator(ajv, BROWSER_SCHEMA_IDS.fragment),
  };
}

function requireValidator<T>(ajv: Ajv2020, id: string): ValidateFunction<T> {
  const validator = ajv.getSchema<T>(id);
  if (!validator) {
    throw new Error(`Browser schema was not registered: ${id}`);
  }
  return validator;
}
