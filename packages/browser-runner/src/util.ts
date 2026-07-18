import { createHash } from "node:crypto";

import type { ArtifactCaptureMode, ArtifactPolicy, BrowserSelector } from "@testy/browser-schema";
import type { Locator, Page } from "playwright";

import type {
  BrowserRequestCheck,
  BrowserRequestEntry,
  ExpectedBrowserRequest,
} from "./types.js";

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

export function fingerprintText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprintUrl(value: string): string {
  return fingerprintText(sanitizePageUrl(value));
}

export function sanitizePageUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "about:blank";
  }
}

export function selectFailedRequests(
  mode: ArtifactCaptureMode,
  journeyFailed: boolean,
  entries: readonly BrowserRequestEntry[],
): readonly BrowserRequestEntry[] {
  return shouldCapture(mode, journeyFailed)
    ? entries.filter((entry) => entry.failed)
    : [];
}

export function summarizeExpectedRequests(
  expected: readonly ExpectedBrowserRequest[],
  entries: readonly BrowserRequestEntry[],
): readonly BrowserRequestCheck[] {
  const ids = new Set<string>();
  return expected.map((item) => {
    if (ids.has(item.id)) {
      throw new Error(`Expected browser request ID '${item.id}' is duplicated.`);
    }
    ids.add(item.id);
    const method = item.method?.toUpperCase();
    const urlFingerprint = fingerprintUrl(item.url);
    const matched = entries.filter(
      (entry) =>
        entry.urlFingerprint === urlFingerprint &&
        (method === undefined || entry.method.toUpperCase() === method),
    );
    return {
      id: item.id,
      ...(method ? { method } : {}),
      urlFingerprint,
      matchedCount: matched.length,
      successfulCount: matched.filter((entry) => !entry.failed).length,
      failedCount: matched.filter((entry) => entry.failed).length,
    };
  });
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
