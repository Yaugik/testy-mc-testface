export const VENDOR_SCHEMA_VERSION = "1.0" as const;

export const VENDOR_SCHEMA_IDS = {
  vendor: "https://testy-mctestface.dev/schemas/vendor/v1/vendor.schema.json",
  systemCases:
    "https://testy-mctestface.dev/schemas/vendor/v1/system-cases.schema.json",
  operation:
    "https://testy-mctestface.dev/schemas/vendor/v1/operation.schema.json",
} as const;

export const vendorSchemaDirectory = new URL("./schemas/v1/", import.meta.url);

export type VendorSchemaVersion = typeof VENDOR_SCHEMA_VERSION;
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type DurationString = `${number}ms` | `${number}s` | `${number}m`;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ResponseDefinition {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly contentType?: string;
  readonly body?: string;
  readonly delay?: DurationString;
}

export interface TransportFaultDefinition {
  readonly type: "timeout" | "connection-close" | "connection-reset";
  readonly duration?: DurationString;
}

export interface VendorConfig {
  readonly schemaVersion: VendorSchemaVersion;
  readonly vendor: {
    readonly id: string;
    readonly displayName: string;
    readonly contractVersion: string;
  };
  readonly server: {
    readonly basePath: string;
    readonly defaultContentType: string;
  };
  readonly authentication?: {
    readonly strategies: readonly AuthenticationStrategy[];
  };
  readonly routing: {
    readonly unmatchedRequest: ResponseDefinition;
  };
  readonly privacy: {
    readonly capture: {
      readonly allow: readonly CaptureField[];
      readonly redactHeaders: readonly string[];
    };
  };
}

export type CaptureField =
  | "method"
  | "path"
  | "queryKeys"
  | "selectedHeaders"
  | "bodyFingerprint"
  | "timing";

export interface AuthenticationStrategy {
  readonly id: string;
  readonly type: "bearer" | "api-key" | "basic";
  readonly source: "header" | "query";
  readonly name: string;
  readonly validValues: readonly string[];
  readonly onFailure: ResponseDefinition;
}

export interface SystemCasesConfig {
  readonly schemaVersion: VendorSchemaVersion;
  readonly initialState: string;
  readonly states: Readonly<Record<string, SystemStateDefinition>>;
  readonly transitions?: readonly StateTransitionDefinition[];
}

export interface SystemStateDefinition {
  readonly defaults?: {
    readonly delay?: DurationString;
  };
  readonly override?: ResponseDefinition;
}

export interface StateTransitionDefinition {
  readonly from: string;
  readonly to: string;
  readonly when: {
    readonly requestCountAtLeast: number;
  };
}

export interface OperationConfig {
  readonly schemaVersion: VendorSchemaVersion;
  readonly operationId: string;
  readonly request: {
    readonly method: HttpMethod;
    readonly path: string;
  };
  readonly cases: readonly OperationCaseDefinition[];
}

export type MatchScalar = JsonPrimitive;

export type MatchExpression =
  | MatchScalar
  | {
      readonly equals?: MatchScalar;
      readonly notEquals?: MatchScalar;
      readonly in?: readonly MatchScalar[];
      readonly present?: boolean;
      readonly absent?: boolean;
      readonly matchesRegex?: string;
      readonly startsWith?: string;
      readonly endsWith?: string;
      readonly contains?: string;
      readonly greaterThan?: number;
      readonly greaterThanOrEqual?: number;
      readonly lessThan?: number;
      readonly lessThanOrEqual?: number;
      readonly between?: readonly [number, number];
    };

export interface StoreMutationDefinition {
  readonly store: string;
  readonly key: string;
  readonly operation: "set" | "increment" | "delete";
  readonly value?: JsonValue;
}

export interface CaseEffectsDefinition {
  readonly setState?: string;
  readonly stores?: readonly StoreMutationDefinition[];
}

export interface SequenceStepDefinition {
  readonly respond?: ResponseDefinition;
  readonly transport?: TransportFaultDefinition;
  readonly effects?: CaseEffectsDefinition;
}

export interface ResponseSequenceDefinition {
  readonly onExhausted: "repeat-last" | "cycle" | "terminal";
  readonly steps: readonly SequenceStepDefinition[];
  readonly terminalResponse?: ResponseDefinition;
}

export interface OperationCaseDefinition {
  readonly id: string;
  readonly priority: number;
  readonly when: Readonly<Record<string, MatchExpression>>;
  readonly respond?: ResponseDefinition;
  readonly transport?: TransportFaultDefinition;
  readonly sequence?: ResponseSequenceDefinition;
  readonly effects?: CaseEffectsDefinition;
}

export interface VendorExecutionModel {
  readonly schemaVersion: VendorSchemaVersion;
  readonly contentHash: string;
  readonly vendor: VendorConfig["vendor"];
  readonly server: VendorConfig["server"];
  readonly authentication: readonly AuthenticationStrategy[];
  readonly routing: VendorConfig["routing"];
  readonly privacy: VendorConfig["privacy"];
  readonly system: {
    readonly initialState: string;
    readonly states: readonly CompiledSystemState[];
    readonly transitions: readonly StateTransitionDefinition[];
  };
  readonly operations: readonly CompiledOperation[];
  readonly assets: readonly VendorAsset[];
}

export interface CompiledSystemState {
  readonly id: string;
  readonly defaultDelayMs?: number;
  readonly override?: ResponseDefinition;
}

export interface CompiledOperation {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly cases: readonly OperationCaseDefinition[];
}

export interface VendorAsset {
  readonly reference: string;
  readonly relativePath: string;
  readonly sha256: string;
  readonly byteLength: number;
}
