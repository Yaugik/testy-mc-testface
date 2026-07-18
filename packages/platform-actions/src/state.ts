import type { LoadedBrowserPackage } from "@testy/browser-schema";
import type { SyntheticSiteBinding } from "@testy/synthetic-site-host";
import type { WrittenVendorBundle } from "@testy/vendor-compiler";
import type { RunningVendorRuntime } from "@testy/vendor-runtime";

import type { PlatformActionDependencies } from "./types.js";

export interface VendorState {
  readonly packageName: string;
  readonly bundle: WrittenVendorBundle;
  runtime?: RunningVendorRuntime;
  runtimeLeaseRegistered: boolean;
  readonly recordedCalls: Set<string>;
}

export interface RunState {
  readonly vendors: Map<string, VendorState>;
  browserPackage?: LoadedBrowserPackage;
  site?: SyntheticSiteBinding;
  siteLeaseRegistered: boolean;
  readonly browserReports: Map<
    string,
    Awaited<ReturnType<PlatformActionDependencies["runBrowserJourney"]>>
  >;
  cleanupRegistered: boolean;
}
