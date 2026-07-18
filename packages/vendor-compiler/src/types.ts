import type { Buffer } from "node:buffer";

export const VENDOR_COMPILER_VERSION = "0.2.0" as const;
export const DEFAULT_IMPOSTER_IMAGE = "outofcoffee/imposter:5" as const;
export const IMPOSTER_CONFIG_DIRECTORY = "/opt/imposter/config" as const;
export const IMPOSTER_CONTAINER_PORT = 8080 as const;
export const IMPOSTER_STATUS_PATH = "/system/status" as const;
export const IMPOSTER_STORE_PATH = "/system/store" as const;
export const TESTY_CORRELATION_HEADER = "X-Testy-Correlation-ID" as const;

export type CompilerWarningCode =
  | "authentication-response-body-ignored"
  | "runtime-image-not-digest-pinned"
  | "timeout-approximated";

export interface CompilerWarning {
  readonly code: CompilerWarningCode;
  readonly message: string;
  readonly operationId?: string;
  readonly caseId?: string;
}

export interface RuntimeStoreManifest {
  readonly state: string;
  readonly counters: string;
  readonly sequences: string;
  readonly user: Readonly<Record<string, string>>;
}

export interface VendorBundleManifest {
  readonly schemaVersion: "1.0";
  readonly bundleId: string;
  readonly compilerVersion: typeof VENDOR_COMPILER_VERSION;
  readonly vendor: {
    readonly id: string;
    readonly contractVersion: string;
  };
  readonly sourceContentHash: string;
  readonly runtime: {
    readonly engine: "imposter";
    readonly image: string;
    readonly containerPort: typeof IMPOSTER_CONTAINER_PORT;
    readonly configMountPath: typeof IMPOSTER_CONFIG_DIRECTORY;
    readonly statusPath: typeof IMPOSTER_STATUS_PATH;
    readonly storePath: typeof IMPOSTER_STORE_PATH;
  };
  readonly endpoint: {
    readonly basePath: string;
  };
  readonly state: {
    readonly execution: "scripted-stores" | "static";
    readonly initialState: string;
    readonly stores?: RuntimeStoreManifest;
  };
  readonly capabilities: {
    readonly authentication: "native-security-policy" | "none";
    readonly requestMatching: readonly string[];
    readonly responseFeatures: readonly string[];
    readonly transportFaults: readonly string[];
    readonly stateTransitions: "scripted-store" | "none-declared";
    readonly responseSequences: "scripted-store" | "none-declared";
    readonly storeMutations: "scripted-store" | "none-declared";
    readonly callLedger: "structured-log-correlation";
  };
  readonly files: readonly BundleFileDescriptor[];
  readonly warnings: readonly CompilerWarning[];
}

export interface BundleFileDescriptor {
  readonly relativePath: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface SourceMapEntry {
  readonly resourceIndex: number;
  readonly vendorId: string;
  readonly operationId?: string;
  readonly caseId?: string;
  readonly sourceFile: string;
  readonly sourcePointer: string;
  readonly generatedPointer: string;
  readonly generatedScript?: string;
}

export interface VendorBundleSourceMap {
  readonly schemaVersion: "1.0";
  readonly entries: readonly SourceMapEntry[];
}

export interface GeneratedBundleFile extends BundleFileDescriptor {
  readonly content: Buffer;
}

export interface CompiledVendorBundle {
  readonly bundleId: string;
  readonly manifest: VendorBundleManifest;
  readonly sourceMap: VendorBundleSourceMap;
  readonly files: readonly GeneratedBundleFile[];
  readonly imposterConfig: Readonly<Record<string, unknown>>;
}

export interface WrittenVendorBundle extends CompiledVendorBundle {
  readonly rootDirectory: string;
  readonly configDirectory: string;
  readonly manifestPath: string;
  readonly sourceMapPath: string;
}

export interface CompileVendorBundleOptions {
  readonly runtimeImage?: string;
  readonly runNamespace?: string;
}
