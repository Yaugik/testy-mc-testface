import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { BrowserContext, Page } from "playwright";

import { sanitizeArtifactName } from "./util.js";

export interface ArtifactWorkspace {
  readonly rootDirectory: string;
  readonly tracePath: string;
  screenshotPath(stepId: string): string;
}

export async function createArtifactWorkspace(
  artifactRoot: string,
  runNamespace: string,
  journeyId: string,
): Promise<ArtifactWorkspace> {
  const rootDirectory = resolve(
    artifactRoot,
    sanitizeArtifactName(runNamespace),
    sanitizeArtifactName(journeyId),
  );
  await mkdir(rootDirectory, { recursive: true });
  return {
    rootDirectory,
    tracePath: join(rootDirectory, "trace.zip"),
    screenshotPath: (stepId) =>
      join(rootDirectory, `${sanitizeArtifactName(stepId)}.png`),
  };
}

export async function captureScreenshot(
  page: Page,
  destination: string,
): Promise<string> {
  await page.screenshot({ path: destination, fullPage: true });
  return destination;
}

export async function startTrace(context: BrowserContext): Promise<void> {
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
}

export async function stopTrace(
  context: BrowserContext,
  destination?: string,
): Promise<void> {
  await context.tracing.stop(destination ? { path: destination } : undefined);
}
