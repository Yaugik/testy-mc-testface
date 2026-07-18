import type {
  BrowserJourneyReport,
  BrowserName,
  ExpectedBrowserRequest,
} from "@testy/browser-runner";
import type { LoadedBrowserPackage } from "@testy/browser-schema";
import type { LoadedVendorPackage } from "@testy/config-loader";
import type {
  PersistedResourceLease,
  ScenarioActionRegistry,
  ScenarioRunRepository,
} from "@testy/scenario-engine";
import type { SyntheticSiteBinding } from "@testy/synthetic-site-host";
import type {
  CompiledVendorBundle,
  WrittenVendorBundle,
} from "@testy/vendor-compiler";
import type {
  ContainerEngine,
  RunningVendorRuntime,
  RuntimeStartOptions,
} from "@testy/vendor-runtime";

export interface PlatformActionOptions {
  readonly vendorPackagesRoot: string;
  readonly browserPackagesRoot: string;
  readonly generatedRoot: string;
  readonly evidence: ScenarioRunRepository;
  readonly runtimeImage?: string;
  readonly runtimeNetworkName?: string;
  readonly browser?: BrowserName;
  readonly headless?: boolean;
  readonly containerEngine?: ContainerEngine;
  readonly delegates?: {
    readonly configureVendorEndpoints?: ScenarioActionRegistry[string];
    readonly configureSyntheticSite?: ScenarioActionRegistry[string];
  };
  readonly dependencies?: Partial<PlatformActionDependencies>;
}

export interface PlatformActionDependencies {
  validateVendorPackagePrivacy(
    path: string,
  ): Promise<{ readonly passed: boolean; readonly scannedFiles: number }>;
  loadVendorPackage(path: string): Promise<LoadedVendorPackage>;
  compileVendorBundle(
    loaded: LoadedVendorPackage,
    options: { readonly runtimeImage?: string; readonly runNamespace?: string },
  ): CompiledVendorBundle;
  writeVendorBundle(
    bundle: CompiledVendorBundle,
    outputRoot: string,
  ): Promise<WrittenVendorBundle>;
  startVendorRuntime(
    bundle: WrittenVendorBundle,
    options: RuntimeStartOptions,
  ): Promise<RunningVendorRuntime>;
  loadBrowserPackage(path: string): Promise<LoadedBrowserPackage>;
  startSyntheticSite(
    loaded: LoadedBrowserPackage,
    options: { readonly runNamespace: string },
  ): Promise<SyntheticSiteBinding>;
  runBrowserJourney(
    journeyId: string,
    loaded: LoadedBrowserPackage,
    site: SyntheticSiteBinding,
    options: {
      readonly browser?: BrowserName;
      readonly headless?: boolean;
      readonly artifactRoot: string;
      readonly runNamespace: string;
      readonly signal?: AbortSignal;
      readonly externalScripts?: readonly string[];
      readonly expectedRequests?: readonly ExpectedBrowserRequest[];
    },
  ): Promise<BrowserJourneyReport>;
}

export interface PlatformActionDiagnostics {
  activeRunIds(): readonly string[];
}

export interface PlatformActionBundle {
  readonly actions: ScenarioActionRegistry;
  readonly resourceCleaners: Readonly<
    Record<string, (lease: PersistedResourceLease) => Promise<void>>
  >;
  readonly diagnostics: PlatformActionDiagnostics;
}
