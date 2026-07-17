import type { ArtifactPolicy, JourneyActionDefinition } from "@testy/browser-schema";

export type BrowserName = "chromium" | "firefox" | "webkit";
export type JourneyStatus = "passed" | "failed" | "cancelled";

export interface BrowserRunnerOptions {
  readonly browser?: BrowserName;
  readonly headless?: boolean;
  readonly artifactRoot: string;
  readonly runNamespace: string;
  readonly signal?: AbortSignal;
}

export interface BrowserActionResult {
  readonly stepId: string;
  readonly action: JourneyActionDefinition["action"];
  readonly status: "passed" | "failed";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly pageUrl?: string;
  readonly error?: string;
  readonly screenshotPath?: string;
}

export interface BrowserConsoleEntry {
  readonly timestamp: string;
  readonly type: string;
  readonly text: string;
}

export interface BrowserRequestEntry {
  readonly timestamp: string;
  readonly method: string;
  readonly urlFingerprint: string;
  readonly status?: number;
  readonly failed: boolean;
  readonly failureText?: string;
}

export interface BrowserArtifactManifest {
  readonly rootDirectory: string;
  readonly tracePath?: string;
  readonly screenshots: readonly string[];
}

export interface BrowserJourneyReport {
  readonly schemaVersion: "1.0";
  readonly customerId: string;
  readonly siteId: string;
  readonly journeyId: string;
  readonly contentHash: string;
  readonly browser: BrowserName;
  readonly status: JourneyStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly actions: readonly BrowserActionResult[];
  readonly console: readonly BrowserConsoleEntry[];
  readonly requests: readonly BrowserRequestEntry[];
  readonly artifacts: BrowserArtifactManifest;
  readonly error?: string;
}

export interface ArtifactDecisionInput {
  readonly policy: ArtifactPolicy;
  readonly failed: boolean;
}
