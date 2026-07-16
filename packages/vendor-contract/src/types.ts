import type { JsonValue } from "@testy/vendor-schema";

export type ContractHttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE";

export interface VendorContractSuite {
  readonly schemaVersion: "1.0";
  readonly suiteId: string;
  readonly defaults?: {
    readonly headers?: Readonly<Record<string, string>>;
    readonly query?: Readonly<Record<string, string>>;
    readonly requestTimeoutMs?: number;
  };
  readonly cases: readonly VendorContractCase[];
}

export interface VendorContractCase {
  readonly id: string;
  readonly resetBefore?: boolean;
  readonly steps: readonly VendorContractStep[];
  readonly expect?: {
    readonly state?: string;
    readonly stores?: Readonly<
      Record<string, Readonly<Record<string, JsonValue>>>
    >;
  };
}

export interface VendorContractStep {
  readonly id: string;
  readonly request: {
    readonly method: ContractHttpMethod;
    readonly path: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly query?: Readonly<Record<string, string>>;
    readonly jsonBody?: JsonValue;
    readonly timeoutMs?: number;
  };
  readonly expect: {
    readonly status?: number;
    readonly transportError?: boolean;
    readonly matchedCase?: string;
    readonly sequenceIndex?: number;
    readonly stateBefore?: string;
    readonly stateAfter?: string;
  };
}

export interface VendorContractCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
  readonly caseId?: string;
  readonly stepId?: string;
  readonly correlationId?: string;
}

export interface VendorContractReport {
  readonly schemaVersion: "1.0";
  readonly suiteId: string;
  readonly vendorId: string;
  readonly bundleId: string;
  readonly passed: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly checks: readonly VendorContractCheck[];
}

export interface RunVendorContractOptions {
  readonly fetcher?: typeof fetch;
  readonly correlationPrefix?: string;
  readonly ledgerTimeoutMs?: number;
  readonly ledgerPollIntervalMs?: number;
  readonly resetAfter?: boolean;
}
