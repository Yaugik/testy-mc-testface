import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import type {
  OperationConfig,
  ResponseDefinition,
  SystemCasesConfig,
  VendorAsset,
  VendorConfig,
} from "@testy/vendor-schema";

import type { ValidationIssue } from "./errors.js";

export interface LoadedAsset extends VendorAsset {
  readonly absolutePath: string;
  readonly content: Buffer;
}

export async function loadReferencedAssets(
  rootDir: string,
  vendor: VendorConfig,
  systemCases: SystemCasesConfig,
  operations: readonly OperationConfig[],
): Promise<readonly LoadedAsset[]> {
  const references = collectAssetReferences(vendor, systemCases, operations);
  const assets: LoadedAsset[] = [];
  const issues: ValidationIssue[] = [];

  for (const reference of [...references].sort()) {
    try {
      const absolutePath = resolveAssetPath(rootDir, reference);
      const metadata = await stat(absolutePath);

      if (!metadata.isFile()) {
        throw new Error("reference does not point to a file");
      }

      const content = await readFile(absolutePath);
      validateAssetContent(reference, content);
      assets.push({
        reference,
        relativePath: normalizePath(relative(rootDir, absolutePath)),
        absolutePath,
        content,
        sha256: createHash("sha256").update(content).digest("hex"),
        byteLength: content.byteLength,
      });
    } catch (error) {
      issues.push({
        code: "asset-invalid",
        message: `Invalid response asset '${reference}': ${getErrorMessage(error)}`,
      });
    }
  }

  if (issues.length > 0) {
    throw new AssetValidationError(issues);
  }

  return assets;
}

function validateAssetContent(reference: string, content: Buffer): void {
  if (extname(reference).toLowerCase() === ".json") {
    JSON.parse(content.toString("utf8"));
  }
}

function collectAssetReferences(
  vendor: VendorConfig,
  systemCases: SystemCasesConfig,
  operations: readonly OperationConfig[],
): Set<string> {
  const references = new Set<string>();
  const addResponse = (response: ResponseDefinition | undefined): void => {
    if (response?.body) {
      references.add(response.body);
    }
  };

  for (const strategy of vendor.authentication?.strategies ?? []) {
    addResponse(strategy.onFailure);
  }
  addResponse(vendor.routing.unmatchedRequest);

  for (const state of Object.values(systemCases.states)) {
    addResponse(state.override);
  }

  for (const operation of operations) {
    for (const operationCase of operation.cases) {
      addResponse(operationCase.respond);
    }
  }

  return references;
}

function resolveAssetPath(rootDir: string, reference: string): string {
  if (isAbsolute(reference)) {
    throw new Error("absolute paths are not allowed");
  }

  const resolvedRoot = resolve(rootDir);
  const resolvedAsset = resolve(resolvedRoot, reference);
  const relativePath = relative(resolvedRoot, resolvedAsset);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("path escapes the vendor package");
  }

  return resolvedAsset;
}

function normalizePath(value: string): string {
  return value.split(sep).join("/");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AssetValidationError extends Error {
  public readonly issues: readonly ValidationIssue[];

  public constructor(issues: readonly ValidationIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
    this.name = "AssetValidationError";
    this.issues = issues;
  }
}
