import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import type { ValidateFunction } from "ajv";

import type {
  OperationConfig,
  SystemCasesConfig,
  VendorConfig,
  VendorExecutionModel,
} from "@testy/vendor-schema";

import {
  AssetValidationError,
  loadReferencedAssets,
  type LoadedAsset,
} from "./assets.js";
import { parseDuration } from "./duration.js";
import {
  VendorPackageValidationError,
  type ValidationIssue,
} from "./errors.js";
import { hashPackage } from "./hash.js";
import { createVendorSchemaRegistry } from "./schema-registry.js";
import {
  loadYamlDocument,
  validateYamlDocument,
  YamlDocumentError,
  type LoadedYamlDocument,
} from "./yaml-document.js";

export interface LoadedVendorPackage {
  readonly rootDir: string;
  readonly vendorFile: LoadedYamlDocument<VendorConfig>;
  readonly systemCasesFile: LoadedYamlDocument<SystemCasesConfig>;
  readonly operationFiles: readonly LoadedYamlDocument<OperationConfig>[];
  readonly assets: readonly LoadedAsset[];
  readonly contentHash: string;
  readonly executionModel: VendorExecutionModel;
}

export async function loadVendorPackage(
  packagePath: string,
): Promise<LoadedVendorPackage> {
  const rootDir = resolve(packagePath);
  const registry = await createVendorSchemaRegistry();
  const issues: ValidationIssue[] = [];

  const vendorFile = await collectDocument(
    join(rootDir, "vendor.yaml"),
    registry.vendor,
    issues,
  );
  const systemCasesFile = await collectDocument(
    join(rootDir, "system-cases.yaml"),
    registry.systemCases,
    issues,
  );
  const operationFiles = await collectOperationDocuments(
    rootDir,
    registry.operation,
    issues,
  );

  if (!vendorFile || !systemCasesFile || operationFiles.length === 0) {
    if (operationFiles.length === 0) {
      issues.push({
        code: "package-invalid",
        message: "Vendor package must contain at least one YAML file under apis/.",
      });
    }
    throw new VendorPackageValidationError(issues);
  }

  validatePackageSemantics(vendorFile, systemCasesFile, operationFiles, issues);

  let assets: readonly LoadedAsset[] = [];
  try {
    assets = await loadReferencedAssets(
      rootDir,
      vendorFile.value,
      systemCasesFile.value,
      operationFiles.map((file) => file.value),
    );
  } catch (error) {
    if (error instanceof AssetValidationError) {
      issues.push(...error.issues);
    } else {
      throw error;
    }
  }

  if (issues.length > 0) {
    throw new VendorPackageValidationError(issues);
  }

  const contentHash = hashPackage([
    toHashInput(rootDir, vendorFile),
    toHashInput(rootDir, systemCasesFile),
    ...operationFiles.map((file) => toHashInput(rootDir, file)),
    ...assets.map((asset) => ({
      relativePath: asset.relativePath,
      content: asset.content,
    })),
  ]);

  return {
    rootDir,
    vendorFile,
    systemCasesFile,
    operationFiles,
    assets,
    contentHash,
    executionModel: buildExecutionModel(
      vendorFile.value,
      systemCasesFile.value,
      operationFiles.map((file) => file.value),
      assets,
      contentHash,
    ),
  };
}

async function collectOperationDocuments(
  rootDir: string,
  validator: ValidateFunction<OperationConfig>,
  issues: ValidationIssue[],
): Promise<LoadedYamlDocument<OperationConfig>[]> {
  const apiDir = join(rootDir, "apis");
  let fileNames: string[];

  try {
    fileNames = (await readdir(apiDir))
      .filter((fileName) => /\.ya?ml$/u.test(fileName))
      .sort();
  } catch (error) {
    issues.push({
      code: "package-invalid",
      message: `Unable to read vendor API directory '${apiDir}': ${getErrorMessage(error)}`,
    });
    return [];
  }

  const documents: LoadedYamlDocument<OperationConfig>[] = [];
  for (const fileName of fileNames) {
    const document = await collectDocument(
      join(apiDir, fileName),
      validator,
      issues,
    );
    if (document) {
      documents.push(document);
    }
  }
  return documents;
}

async function collectDocument<T>(
  filePath: string,
  validator: ValidateFunction<T>,
  issues: ValidationIssue[],
): Promise<LoadedYamlDocument<T> | undefined> {
  try {
    const document = await loadYamlDocument<unknown>(filePath);
    validateYamlDocument(document, validator);
    return document;
  } catch (error) {
    if (error instanceof YamlDocumentError) {
      issues.push(...error.issues);
      return undefined;
    }

    issues.push({
      code: "package-invalid",
      message: `Unable to load '${filePath}': ${getErrorMessage(error)}`,
    });
    return undefined;
  }
}

function validatePackageSemantics(
  vendorFile: LoadedYamlDocument<VendorConfig>,
  systemCasesFile: LoadedYamlDocument<SystemCasesConfig>,
  operationFiles: readonly LoadedYamlDocument<OperationConfig>[],
  issues: ValidationIssue[],
): void {
  const stateIds = new Set(Object.keys(systemCasesFile.value.states));
  if (!stateIds.has(systemCasesFile.value.initialState)) {
    issues.push({
      code: "package-invalid",
      message: `Initial system state '${systemCasesFile.value.initialState}' is not defined.`,
      location: {
        filePath: systemCasesFile.filePath,
        line: 1,
        column: 1,
        instancePath: "/initialState",
      },
    });
  }

  for (const transition of systemCasesFile.value.transitions ?? []) {
    if (!stateIds.has(transition.from) || !stateIds.has(transition.to)) {
      issues.push({
        code: "package-invalid",
        message: `Transition '${transition.from}' -> '${transition.to}' references an undefined state.`,
        location: {
          filePath: systemCasesFile.filePath,
          line: 1,
          column: 1,
          instancePath: "/transitions",
        },
      });
    }
  }

  const operationIds = new Map<string, string>();
  for (const operationFile of operationFiles) {
    const existingFile = operationIds.get(operationFile.value.operationId);
    if (existingFile) {
      issues.push({
        code: "package-invalid",
        message: `Operation ID '${operationFile.value.operationId}' is duplicated in '${existingFile}' and '${operationFile.filePath}'.`,
        location: {
          filePath: operationFile.filePath,
          line: 1,
          column: 1,
          instancePath: "/operationId",
        },
      });
    } else {
      operationIds.set(operationFile.value.operationId, operationFile.filePath);
    }

    const caseIds = new Set<string>();
    for (const operationCase of operationFile.value.cases) {
      if (caseIds.has(operationCase.id)) {
        issues.push({
          code: "package-invalid",
          message: `Case ID '${operationCase.id}' is duplicated in operation '${operationFile.value.operationId}'.`,
          location: {
            filePath: operationFile.filePath,
            line: 1,
            column: 1,
            instancePath: "/cases",
          },
        });
      }
      caseIds.add(operationCase.id);
    }
  }

  if (!vendorFile.value.privacy.capture.redactHeaders.some(
    (header) => header.toLowerCase() === "authorization",
  )) {
    issues.push({
      code: "package-invalid",
      message: "privacy.capture.redactHeaders must include Authorization.",
      location: {
        filePath: vendorFile.filePath,
        line: 1,
        column: 1,
        instancePath: "/privacy/capture/redactHeaders",
      },
    });
  }
}

function buildExecutionModel(
  vendor: VendorConfig,
  systemCases: SystemCasesConfig,
  operations: readonly OperationConfig[],
  assets: readonly LoadedAsset[],
  contentHash: string,
): VendorExecutionModel {
  return {
    schemaVersion: vendor.schemaVersion,
    contentHash,
    vendor: vendor.vendor,
    server: vendor.server,
    authentication: vendor.authentication?.strategies ?? [],
    routing: vendor.routing,
    privacy: vendor.privacy,
    system: {
      initialState: systemCases.initialState,
      states: Object.entries(systemCases.states)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, state]) => ({
          id,
          ...(state.defaults?.delay
            ? { defaultDelayMs: parseDuration(state.defaults.delay) }
            : {}),
          ...(state.override ? { override: state.override } : {}),
        })),
      transitions: systemCases.transitions ?? [],
    },
    operations: [...operations]
      .sort((left, right) => left.operationId.localeCompare(right.operationId))
      .map((operation) => ({
        id: operation.operationId,
        method: operation.request.method,
        path: operation.request.path,
        cases: [...operation.cases].sort(
          (left, right) => right.priority - left.priority,
        ),
      })),
    assets: assets.map((asset) => ({
      reference: asset.reference,
      relativePath: asset.relativePath,
      sha256: asset.sha256,
      byteLength: asset.byteLength,
    })),
  };
}

function toHashInput(
  rootDir: string,
  file: LoadedYamlDocument<unknown>,
): { readonly relativePath: string; readonly content: string } {
  return {
    relativePath: normalizePath(relative(rootDir, file.filePath)),
    content: file.content,
  };
}

function normalizePath(value: string): string {
  return value.split(sep).join("/");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
