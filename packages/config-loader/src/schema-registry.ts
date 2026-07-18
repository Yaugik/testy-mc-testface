import { readFile } from "node:fs/promises";

import type { AnySchema, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  VENDOR_SCHEMA_IDS,
  vendorSchemaDirectory,
  type OperationConfig,
  type SystemCasesConfig,
  type VendorConfig,
} from "@testy/vendor-schema";

export interface VendorSchemaRegistry {
  readonly vendor: ValidateFunction<VendorConfig>;
  readonly systemCases: ValidateFunction<SystemCasesConfig>;
  readonly operation: ValidateFunction<OperationConfig>;
}

export async function createVendorSchemaRegistry(): Promise<VendorSchemaRegistry> {
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
  });
  addFormats(ajv);

  const schemas = await Promise.all([
    readSchema("vendor.schema.json"),
    readSchema("system-cases.schema.json"),
    readSchema("operation.schema.json"),
  ]);

  for (const schema of schemas) {
    ajv.addSchema(schema);
  }

  return {
    vendor: requireValidator<VendorConfig>(ajv, VENDOR_SCHEMA_IDS.vendor),
    systemCases: requireValidator<SystemCasesConfig>(
      ajv,
      VENDOR_SCHEMA_IDS.systemCases,
    ),
    operation: requireValidator<OperationConfig>(
      ajv,
      VENDOR_SCHEMA_IDS.operation,
    ),
  };
}

async function readSchema(fileName: string): Promise<AnySchema> {
  const content = await readFile(new URL(fileName, vendorSchemaDirectory), "utf8");
  return JSON.parse(content) as AnySchema;
}

function requireValidator<T>(
  ajv: Ajv2020,
  schemaId: string,
): ValidateFunction<T> {
  const validator = ajv.getSchema<T>(schemaId);

  if (!validator) {
    throw new Error(`Schema was not registered: ${schemaId}`);
  }

  return validator;
}
