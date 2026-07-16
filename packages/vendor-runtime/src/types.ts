import type { WrittenVendorBundle } from "@testy/vendor-compiler";

export interface ContainerMount {
  readonly hostPath: string;
  readonly containerPath: string;
  readonly readOnly: boolean;
}

export interface ContainerPortBinding {
  readonly hostAddress: string;
  readonly containerPort: number;
}

export interface ContainerRunSpec {
  readonly image: string;
  readonly name: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly labels: Readonly<Record<string, string>>;
  readonly mounts: readonly ContainerMount[];
  readonly ports: readonly ContainerPortBinding[];
}

export interface ContainerHandle {
  readonly id: string;
}

export interface ContainerEngine {
  run(spec: ContainerRunSpec): Promise<ContainerHandle>;
  resolveHostPort(containerId: string, containerPort: number): Promise<number>;
  logs(containerId: string): Promise<string>;
  remove(containerId: string): Promise<void>;
}

export interface ImposterStatus {
  readonly status: string;
  readonly version?: string;
}

export interface RuntimeStartOptions {
  readonly startupTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly signal?: AbortSignal;
  readonly containerName?: string;
}

export interface RunningVendorRuntime {
  readonly containerId: string;
  readonly containerName: string;
  readonly baseUrl: string;
  readonly providerBaseUrl: string;
  readonly status: ImposterStatus;
  readonly bundle: WrittenVendorBundle;
  logs(): Promise<string>;
  collectLedger(): Promise<readonly ProviderCallLedgerEntry[]>;
  stop(): Promise<void>;
}

export interface ProviderCallLedgerEntry {
  readonly vendorId: string;
  readonly operationId?: string;
  readonly caseId?: string;
  readonly unmatched: boolean;
  readonly correlationId?: string;
  readonly timestamp?: string;
  readonly method?: string;
  readonly pathFingerprint?: string;
  readonly statusCode?: number;
  readonly durationMs?: number;
}
