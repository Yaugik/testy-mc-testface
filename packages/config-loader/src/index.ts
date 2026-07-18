import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LineCounter, parseDocument } from "yaml";

export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface LoadedConfiguration<Value> {
  readonly value: Value;
  readonly source: SourceLocation;
  readonly contentHash: string;
}

export class ConfigurationError extends Error {
  public readonly file: string;
  public readonly line?: number;
  public readonly column?: number;

  public constructor(
    message: string,
    file: string,
    line?: number,
    column?: number,
  ) {
    super(message);
    this.name = "ConfigurationError";
    this.file = file;
    this.line = line;
    this.column = column;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }

  return value;
}

export function contentHash(value: unknown): string {
  const payload = JSON.stringify(canonicalize(value));
  return createHash("sha256").update(payload).digest("hex");
}

export async function loadYamlFile<Value = unknown>(
  file: string,
): Promise<LoadedConfiguration<Value>> {
  const absoluteFile = resolve(file);
  const source = await readFile(absoluteFile, "utf8");
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    lineCounter,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });

  const error = document.errors[0];
  if (error !== undefined) {
    const position = error.linePos?.[0];
    throw new ConfigurationError(
      error.message,
      absoluteFile,
      position?.line,
      position?.col,
    );
  }

  const value = document.toJS({ maxAliasCount: 50 }) as Value;
  const start = document.contents?.range?.[0] ?? 0;
  const position = lineCounter.linePos(start);

  return {
    value,
    source: {
      file: absoluteFile,
      line: position.line,
      column: position.col,
    },
    contentHash: contentHash(value),
  };
}

export function assertUniqueIds(
  values: readonly { readonly id: string }[],
  kind: string,
  file: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      throw new ConfigurationError(
        `Duplicate ${kind} identifier: ${value.id}`,
        file,
      );
    }
    seen.add(value.id);
  }
}
