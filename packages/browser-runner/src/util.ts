import { createHash } from "node:crypto";

import type { ArtifactCaptureMode, ArtifactPolicy, BrowserSelector } from "@testy/browser-schema";
import type { Locator, Page } from "playwright";

export function shouldCapture(mode: ArtifactCaptureMode, failed: boolean): boolean {
  return mode === "always" || (mode === "on-failure" && failed);
}

export function sanitizeArtifactName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return (normalized || "artifact").slice(0, 120);
}

export function fingerprintUrl(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return createHash("sha256").update(url.toString()).digest("hex");
}

export function locatorFor(page: Page, selector: BrowserSelector): Locator {
  if ("testId" in selector) return page.getByTestId(selector.testId);
  if ("role" in selector) {
    return page.getByRole(selector.role as Parameters<Page["getByRole"]>[0], {
      name: selector.name,
    });
  }
  if ("label" in selector) return page.getByLabel(selector.label);
  if ("placeholder" in selector) return page.getByPlaceholder(selector.placeholder);
  return page.locator(selector.css);
}

export function mergeArtifactPolicy(
  base: ArtifactPolicy,
  override: Partial<ArtifactPolicy> | undefined,
): ArtifactPolicy {
  return { ...base, ...(override ?? {}) };
}
