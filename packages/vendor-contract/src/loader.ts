import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AnySchema, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

import { VendorContractValidationError } from "./errors.js";
import type { VendorContractSuite } from "./types.js";

const CONTRACT_SCHEMA_ID =
  "https://testy-mctestface.dev/schemas/vendor-contract/v1/contract.schema.json";

export async function loadVendorContractSuite(
  packagePath: string,
): Promise<VendorContractSuite> {
  const filePath = join(resolve(packagePath), "contract.yaml");
  const content = await readFile(filePath, "utf8");
  const document = parseDocument(content, {
    merge: false,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    throw new VendorContractValidationError(
      document.errors.map((error) => `${filePath}: ${error.message}`),
    );
  }

  const value = document.toJS({ maxAliasCount: 0 }) as unknown;
  const validator = await createValidator();
  if (!validator(value)) {
    throw new VendorContractValidationError(
      (validator.errors ?? []).map(
        (error) =>
          `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
      ),
    );
  }

  validateIdentifiers(value);
  return value;
}

function validateIdentifiers(value: VendorContractSuite): void {
  const issues: string[] = [];
  const caseIds = new Set<string>();
  for (const contractCase of value.cases) {
    if (caseIds.has(contractCase.id)) {
      issues.push(`Duplicate contract case ID '${contractCase.id}'.`);
    }
    caseIds.add(contractCase.id);

    const stepIds = new Set<string>();
    for (const step of contractCase.steps) {
      if (stepIds.has(step.id)) {
        issues.push(
          `Duplicate step ID '${step.id}' in contract case '${contractCase.id}'.`,
        );
      }
      stepIds.add(step.id);
    }
  }

  if (issues.length > 0) {
    throw new VendorContractValidationError(issues);
  }
}

async function createValidator(): Promise<
  ValidateFunction<VendorContractSuite>
> {
  const schemaContent = await readFile(
    new URL("../schemas/v1/contract.schema.json", import.meta.url),
    "utf8",
  );
  const schema = JSON.parse(schemaContent) as AnySchema;
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
  });
  ajv.addSchema(schema);
  const validator = ajv.getSchema<VendorContractSuite>(CONTRACT_SCHEMA_ID);
  if (!validator) {
    throw new Error(`Contract schema was not registered: ${CONTRACT_SCHEMA_ID}`);
  }
  return validator;
}
