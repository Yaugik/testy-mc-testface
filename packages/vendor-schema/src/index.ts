export const VENDOR_SCHEMA_VERSION = "1.0" as const;

export const vendorSchemaV1 = {
  $id: "https://testy.example/schemas/vendor/1.0/vendor.schema.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "vendor",
    "basePath",
    "authentication",
    "operations",
    "systemCasesFile",
    "capturePolicy",
  ],
  properties: {
    schemaVersion: { const: VENDOR_SCHEMA_VERSION },
    vendor: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name"],
      properties: {
        id: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
        name: { type: "string", minLength: 1 },
      },
    },
    basePath: { type: "string", pattern: "^/" },
    authentication: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { enum: ["none", "bearer", "header", "query"] },
        name: { type: "string", minLength: 1 },
      },
    },
    operations: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "method", "path"],
        properties: {
          id: { type: "string", pattern: "^[a-z][a-zA-Z0-9-]*$" },
          method: { enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          path: { type: "string", pattern: "^/" },
        },
      },
    },
    systemCasesFile: { type: "string", pattern: "\\.ya?ml$" },
    capturePolicy: {
      type: "object",
      additionalProperties: false,
      required: ["headers", "query", "body"],
      properties: {
        headers: { type: "array", items: { type: "string" }, uniqueItems: true },
        query: { type: "array", items: { type: "string" }, uniqueItems: true },
        body: { enum: ["none", "fingerprint"] },
      },
    },
  },
} as const;

export const systemCasesSchemaV1 = {
  $id: "https://testy.example/schemas/vendor/1.0/system-cases.schema.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "cases"],
  properties: {
    schemaVersion: { const: VENDOR_SCHEMA_VERSION },
    cases: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "operation", "match", "response"],
        properties: {
          id: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
          operation: { type: "string", minLength: 1 },
          match: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: { type: "object", additionalProperties: { type: "string" } },
              query: { type: "object", additionalProperties: { type: "string" } },
              headers: { type: "object", additionalProperties: { type: "string" } },
            },
          },
          response: {
            type: "object",
            additionalProperties: false,
            required: ["status", "fixture"],
            properties: {
              status: { type: "integer", minimum: 100, maximum: 599 },
              fixture: { type: "string", pattern: "\\.json$" },
              delayMs: { type: "integer", minimum: 0, maximum: 30000 },
            },
          },
        },
      },
    },
  },
} as const;

export interface VendorDefinition {
  readonly schemaVersion: typeof VENDOR_SCHEMA_VERSION;
  readonly vendor: { readonly id: string; readonly name: string };
  readonly basePath: string;
  readonly authentication: {
    readonly type: "none" | "bearer" | "header" | "query";
    readonly name?: string;
  };
  readonly operations: ReadonlyArray<{
    readonly id: string;
    readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    readonly path: string;
  }>;
  readonly systemCasesFile: string;
  readonly capturePolicy: {
    readonly headers: readonly string[];
    readonly query: readonly string[];
    readonly body: "none" | "fingerprint";
  };
}

export interface SystemCaseDefinition {
  readonly id: string;
  readonly operation: string;
  readonly match: {
    readonly path?: Readonly<Record<string, string>>;
    readonly query?: Readonly<Record<string, string>>;
    readonly headers?: Readonly<Record<string, string>>;
  };
  readonly response: {
    readonly status: number;
    readonly fixture: string;
    readonly delayMs?: number;
  };
}

export interface SystemCasesDefinition {
  readonly schemaVersion: typeof VENDOR_SCHEMA_VERSION;
  readonly cases: readonly SystemCaseDefinition[];
}
