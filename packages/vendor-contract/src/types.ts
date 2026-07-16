import type { JsonValue } from "@testy/vendor-schema";

export type ContractHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface NumericRangeExpectation {
  readonly min?: number;
  readonly max?: number;
}

export interface CountExpectation {
  readonly exact?: number;
  readonly min?: number;
  readonly max?: number;
}

export interface VendorRequestDefinition {
  readonly method: ContractHttpMethod;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
  readonly jsonBody?: JsonValue;
  readonly timeoutMs?: number;
}

export interface VendorStepExpectation {
  readonly status?: number;
  readonly transportError?: boolean;
  readonly matchedCase?: string;
  readonly sequenceIndex?: number;
  readonly stateBefore?: string;
  readonly stateAfter?: string;
  readonly durationMs?: NumericRangeExpectation;
}

export interface VendorCallExpectations {
  readonly total?: CountExpectation;
  readonly byCase?: Readonly<Record<string, CountExpectation>>;
  readonly orderedCases?: readonly string[];
  readonly absentCases?: readonly string[];
  readonly durationMs?: NumericRangeExpectation;
  readonly retryIntervalMs?: NumericRangeExpectation;
}

export interface VendorStateExpectation {
  readonly state?: string;
  readonly stores?: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  readonly absentStoreKeys?: Readonly<Record<string, readonly string[]>>;
}

export interface VendorContractSuite {
  readonly schemaVersion: "1.0";
  readonly suiteId: string;
  readonly defaults?: {
    readonly headers?: Readonly<Record<string, string>>;
    readonly query?: Readonly<Record<string, string>>;
    readonly requestTimeoutMs?: number;
  };
  readonly cases: readonly VendorContractCase[];
  readonly isolation?: VendorIsolationDefinition;
}

export interface VendorContractCase {
  readonly id: string;
  readonly resetBefore?: boolean;
  readonly steps: readonly VendorContractStep[];
  readonly expect?: VendorStateExpectation & {
    readonly calls?: VendorCallExpectations;
  };
}

export interface VendorContractStep {
  readonly id: string;
  readonly request: VendorRequestDefinition;
  readonly expect: VendorStepExpectation;
}

export interface VendorIsolationDefinition {
  readonly id: string;
  readonly request: VendorRequestDefinition;
  readonly expect: VendorStepExpectation;
  readonly mutated: VendorStateExpectation;
  readonly untouched: VendorStateExpectation;
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

export interface VendorIsolationReport {
  readonly schemaVersion: "1.0";
  readonly suiteId: string;
  readonly vendorId: string;
  readonly bundleIds: readonly [string, string];
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
  readonly ledgerSettlePolls?: number;
  readonly resetAfter?: boolean;
}
