import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import Ajv, { type ErrorObject } from "ajv";
import { stringify } from "yaml";
import {
  assertUniqueIds,
  contentHash,
  loadYamlFile,
  type SourceLocation,
} from "@testy/config-loader";
import {
  systemCasesSchemaV1,
  vendorSchemaV1,
  type SystemCaseDefinition,
  type SystemCasesDefinition,
  type VendorDefinition,
} from "@testy/vendor-schema";

export interface VendorExecutionModel {
  readonly vendor: VendorDefinition["vendor"];
  readonly basePath: string;
  readonly authentication: VendorDefinition["authentication"];
  readonly operations: VendorDefinition["operations"];
  readonly cases: readonly SystemCaseDefinition[];
  readonly capturePolicy: VendorDefinition["capturePolicy"];
  readonly contentHash: string;
}

export interface LoadedVendorPackage {
  readonly directory: string;
  readonly vendor: VendorDefinition;
  readonly cases: SystemCasesDefinition;
  readonly sourceMap: Readonly<Record<string, SourceLocation>>;
  readonly model: VendorExecutionModel;
}

export interface CompilationResult {
  readonly outputDirectory: string;
  readonly manifestFile: string;
  readonly imposterConfigFile: string;
  readonly sourceMapFile: string;
  readonly contentHash: string;
}

export class VendorValidationError extends Error {
  public readonly diagnostics: readonly string[];

  public constructor(diagnostics: readonly string[]) {
    super(`Vendor package validation failed:\n${diagnostics.join("\n")}`);
    this.name = "VendorValidationError";
    this.diagnostics = diagnostics;
  }
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validateVendor = ajv.compile(vendorSchemaV1 as object);
const validateSystemCases = ajv.compile(systemCasesSchemaV1 as object);

function formatErrors(file: string, errors: readonly ErrorObject[]): string[] {
  return errors.map((error) => {
    const location = error.instancePath === "" ? "/" : error.instancePath;
    return `${file}${location}: ${error.message ?? "is invalid"}`;
  });
}

function assertSchema(
  file: string,
  value: unknown,
  validator: typeof validateVendor,
): void {
  if (!validator(value)) {
    throw new VendorValidationError(formatErrors(file, validator.errors ?? []));
  }
}

function assertOperationReferences(
  vendor: VendorDefinition,
  cases: SystemCasesDefinition,
  casesFile: string,
): void {
  const operationIds = new Set(vendor.operations.map((operation) => operation.id));
  const unknown = cases.cases
    .filter((systemCase) => !operationIds.has(systemCase.operation))
    .map(
      (systemCase) =>
        `${casesFile}: case ${systemCase.id} references unknown operation ${systemCase.operation}`,
    );

  if (unknown.length > 0) {
    throw new VendorValidationError(unknown);
  }
}

export async function loadVendorPackage(
  vendorDirectory: string,
): Promise<LoadedVendorPackage> {
  const directory = resolve(vendorDirectory);
  const vendorFile = join(directory, "vendor.yaml");
  const loadedVendor = await loadYamlFile<VendorDefinition>(vendorFile);
  assertSchema(vendorFile, loadedVendor.value, validateVendor);

  const casesFile = resolve(directory, loadedVendor.value.systemCasesFile);
  const loadedCases = await loadYamlFile<SystemCasesDefinition>(casesFile);
  assertSchema(casesFile, loadedCases.value, validateSystemCases);

  assertUniqueIds(loadedVendor.value.operations, "operation", vendorFile);
  assertUniqueIds(loadedCases.value.cases, "case", casesFile);
  assertOperationReferences(loadedVendor.value, loadedCases.value, casesFile);

  const model: VendorExecutionModel = {
    vendor: loadedVendor.value.vendor,
    basePath: loadedVendor.value.basePath,
    authentication: loadedVendor.value.authentication,
    operations: loadedVendor.value.operations,
    cases: loadedCases.value.cases,
    capturePolicy: loadedVendor.value.capturePolicy,
    contentHash: contentHash({
      vendor: loadedVendor.value,
      cases: loadedCases.value,
    }),
  };

  return {
    directory,
    vendor: loadedVendor.value,
    cases: loadedCases.value,
    sourceMap: {
      vendor: loadedVendor.source,
      cases: loadedCases.source,
    },
    model,
  };
}

function buildImposterConfig(loaded: LoadedVendorPackage): unknown {
  return {
    plugin: "rest",
    port: 0,
    name: `${loaded.vendor.vendor.id}-generated`,
    stubs: loaded.cases.cases.map((systemCase) => ({
      name: systemCase.id,
      predicates: [
        {
          equals: {
            path: join(
              loaded.vendor.basePath,
              systemCase.match.path?.ip ?? "",
            ).replaceAll("\\", "/"),
          },
        },
      ],
      responses: [
        {
          is: {
            statusCode: systemCase.response.status,
            headers: { "Content-Type": "application/json" },
            file: join("responses", basename(systemCase.response.fixture)).replaceAll(
              "\\",
              "/",
            ),
            ...(systemCase.response.delayMs === undefined
              ? {}
              : { _behaviors: { wait: systemCase.response.delayMs } }),
          },
        },
      ],
    })),
  };
}

export async function compileVendorPackage(
  vendorDirectory: string,
  outputDirectory: string,
): Promise<CompilationResult> {
  const loaded = await loadVendorPackage(vendorDirectory);
  const output = resolve(outputDirectory);
  const imposterDirectory = join(output, "imposter");
  const responsesDirectory = join(imposterDirectory, "responses");
  await mkdir(responsesDirectory, { recursive: true });

  for (const systemCase of loaded.cases.cases) {
    const sourceFixture = resolve(loaded.directory, systemCase.response.fixture);
    const destinationFixture = join(
      responsesDirectory,
      basename(systemCase.response.fixture),
    );
    const fixture = await readFile(sourceFixture, "utf8");
    JSON.parse(fixture);
    await writeFile(destinationFixture, fixture, "utf8");
  }

  const manifestFile = join(output, "manifest.json");
  const imposterConfigFile = join(imposterDirectory, "vendor-config.yaml");
  const sourceMapFile = join(output, "source-map.json");

  await writeFile(
    manifestFile,
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        vendorId: loaded.vendor.vendor.id,
        contentHash: loaded.model.contentHash,
        generatedAt: null,
        sourceFiles: ["vendor.yaml", loaded.vendor.systemCasesFile],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    imposterConfigFile,
    stringify(buildImposterConfig(loaded), { lineWidth: 0 }),
    "utf8",
  );
  await writeFile(
    sourceMapFile,
    `${JSON.stringify(loaded.sourceMap, null, 2)}\n`,
    "utf8",
  );

  return {
    outputDirectory: output,
    manifestFile,
    imposterConfigFile,
    sourceMapFile,
    contentHash: loaded.model.contentHash,
  };
}

export async function validateVendorPackage(vendorDirectory: string): Promise<void> {
  await loadVendorPackage(vendorDirectory);
}

export async function ensureParentDirectory(file: string): Promise<void> {
  await mkdir(dirname(resolve(file)), { recursive: true });
}
