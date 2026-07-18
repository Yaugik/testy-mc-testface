import { readFile } from "node:fs/promises";

import type { ErrorObject, ValidateFunction } from "ajv";
import {
  isNode,
  LineCounter,
  parseDocument,
  type Document,
  type Node,
  type ParsedNode,
} from "yaml";

import type { SourceLocation, ValidationIssue } from "./errors.js";

export interface LoadedYamlDocument<T> {
  readonly filePath: string;
  readonly content: string;
  readonly value: T;
  readonly document: Document.Parsed<ParsedNode>;
  readonly lineCounter: LineCounter;
}

export async function loadYamlDocument<T>(
  filePath: string,
): Promise<LoadedYamlDocument<T>> {
  const content = await readFile(filePath, "utf8");
  const lineCounter = new LineCounter();
  const document = parseDocument(content, {
    lineCounter,
    merge: false,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    const issues: ValidationIssue[] = document.errors.map((error) => {
      const start = error.pos[0] ?? 0;
      const position = lineCounter.linePos(start);

      return {
        code: "yaml-invalid",
        message: error.message,
        location: {
          filePath,
          line: position.line,
          column: position.col,
        },
      };
    });

    throw new YamlDocumentError(issues);
  }

  return {
    filePath,
    content,
    value: document.toJS({ maxAliasCount: 0 }) as T,
    document,
    lineCounter,
  };
}

export function validateYamlDocument<T>(
  loaded: LoadedYamlDocument<unknown>,
  validator: ValidateFunction<T>,
): asserts loaded is LoadedYamlDocument<T> {
  if (validator(loaded.value)) {
    return;
  }

  const issues = (validator.errors ?? []).map((error) => ({
    code: "schema-invalid" as const,
    message: formatAjvMessage(error),
    location: locateAjvError(loaded, error),
  }));

  throw new YamlDocumentError(issues);
}

export class YamlDocumentError extends Error {
  public readonly issues: readonly ValidationIssue[];

  public constructor(issues: readonly ValidationIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
    this.name = "YamlDocumentError";
    this.issues = issues;
  }
}

function locateAjvError(
  loaded: LoadedYamlDocument<unknown>,
  error: ErrorObject,
): SourceLocation {
  const path = decodeJsonPointer(error.instancePath);
  const property = getErrorProperty(error);
  const nodePath = property ? [...path, property] : path;
  const node = findNode(loaded.document, nodePath) ?? findNode(loaded.document, path);
  const offset = node?.range?.[0] ?? 0;
  const position = loaded.lineCounter.linePos(offset);

  return {
    filePath: loaded.filePath,
    line: position.line,
    column: position.col,
    instancePath: error.instancePath,
  };
}

function findNode(
  document: Document.Parsed<ParsedNode>,
  path: readonly (string | number)[],
): Node | undefined {
  const candidate = document.getIn(path, true);
  return isNode(candidate) ? candidate : undefined;
}

function decodeJsonPointer(pointer: string): (string | number)[] {
  if (pointer.length === 0) {
    return [];
  }

  return pointer
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .map((part) => (/^(?:0|[1-9]\d*)$/u.test(part) ? Number(part) : part));
}

function getErrorProperty(error: ErrorObject): string | undefined {
  if (error.keyword === "required") {
    return String(error.params.missingProperty);
  }

  if (error.keyword === "additionalProperties") {
    return String(error.params.additionalProperty);
  }

  return undefined;
}

function formatAjvMessage(error: ErrorObject): string {
  const path = error.instancePath || "/";
  return `${path} ${error.message ?? "is invalid"}`;
}
