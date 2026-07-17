import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ResolvedJourney } from "@testy/browser-config";
import type { JourneyActionDefinition } from "@testy/browser-schema";
import type { SyntheticSiteBinding } from "@testy/synthetic-site-host";
import {
  chromium,
  firefox,
  selectors,
  webkit,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
} from "playwright";

import {
  captureScreenshot,
  createArtifactWorkspace,
  startTrace,
  stopTrace,
} from "./artifacts.js";
import { installNetworkFixtures, installSiteRoute, matchesRequest } from "./network.js";
import type {
  BrowserActionResult,
  BrowserConsoleEntry,
  BrowserJourneyReport,
  BrowserRequestEntry,
  BrowserRunnerOptions,
} from "./types.js";
import { fingerprintUrl, locatorFor, shouldCapture } from "./util.js";

export async function runBrowserJourney(
  journey: ResolvedJourney,
  site: SyntheticSiteBinding,
  options: BrowserRunnerOptions,
): Promise<BrowserJourneyReport> {
  const browserName = options.browser ?? "chromium";
  const workspace = await createArtifactWorkspace(
    options.artifactRoot,
    options.runNamespace,
    journey.journeyId,
  );
  const startedAt = new Date().toISOString();
  const actions: BrowserActionResult[] = [];
  const consoleEntries: BrowserConsoleEntry[] = [];
  const requests: BrowserRequestEntry[] = [];
  const screenshots: string[] = [];
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let traceStarted = false;
  let reportError: string | undefined;

  try {
    throwIfAborted(options.signal);
    await selectors.setTestIdAttribute("data-test");
    browser = await launchBrowser(browserName, options.headless ?? true);
    context = await browser.newContext({
      locale: journey.persona.browser.locale,
      timezoneId: journey.persona.browser.timezoneId,
      colorScheme: journey.persona.browser.colorScheme,
      viewport: journey.persona.browser.viewport,
      serviceWorkers: "block",
    });
    context.setDefaultTimeout(journey.timeoutMs);
    await installSiteRoute(context, site);
    await installNetworkFixtures(context, journey.networkFixtures ?? []);
    await applySession(context, journey, site);
    attachObservers(context, consoleEntries, requests);

    if (journey.artifactPolicy.trace !== "never") {
      await startTrace(context);
      traceStarted = true;
    }

    const pages = new Map<string, Page>();
    let page = await context.newPage();
    pages.set("main", page);
    const observedRequests: Request[] = [];
    context.on("request", (request) => observedRequests.push(request));

    for (const step of journey.steps) {
      throwIfAborted(options.signal);
      const executed = await executeStep(
        step,
        page,
        pages,
        observedRequests,
        site,
        workspace.screenshotPath(step.id),
      );
      page = executed.page;
      actions.push(executed.result);
      if (executed.result.screenshotPath) screenshots.push(executed.result.screenshotPath);
      if (executed.result.status === "failed") {
        reportError = executed.result.error ?? "Browser action failed.";
        if (shouldCapture(journey.artifactPolicy.screenshot, true)) {
          try {
            screenshots.push(
              await captureScreenshot(page, workspace.screenshotPath(`${step.id}-failure`)),
            );
          } catch {
            // Preserve the original action failure.
          }
        }
        break;
      }
    }
  } catch (error) {
    reportError = error instanceof Error ? error.message : String(error);
  } finally {
    const failed = reportError !== undefined;
    if (context && traceStarted) {
      await stopTrace(
        context,
        shouldCapture(journey.artifactPolicy.trace, failed)
          ? workspace.tracePath
          : undefined,
      ).catch(() => undefined);
    }
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }

  const failed = reportError !== undefined;
  const report: BrowserJourneyReport = {
    schemaVersion: "1.0",
    customerId: journey.customerId,
    siteId: journey.siteId,
    journeyId: journey.journeyId,
    contentHash: journey.contentHash,
    browser: browserName,
    status: options.signal?.aborted ? "cancelled" : failed ? "failed" : "passed",
    startedAt,
    completedAt: new Date().toISOString(),
    actions,
    console: shouldCapture(journey.artifactPolicy.console, failed) ? consoleEntries : [],
    requests: shouldCapture(journey.artifactPolicy.failedRequests, failed)
      ? requests.filter((entry) => entry.failed)
      : requests,
    artifacts: {
      rootDirectory: workspace.rootDirectory,
      ...(shouldCapture(journey.artifactPolicy.trace, failed)
        ? { tracePath: workspace.tracePath }
        : {}),
      screenshots,
    },
    ...(reportError ? { error: reportError } : {}),
  };
  await mkdir(workspace.rootDirectory, { recursive: true });
  await writeFile(join(workspace.rootDirectory, "report.json"), JSON.stringify(report, null, 2));
  return report;
}

async function executeStep(
  step: JourneyActionDefinition,
  currentPage: Page,
  pages: Map<string, Page>,
  observedRequests: readonly Request[],
  site: SyntheticSiteBinding,
  screenshotPath: string,
): Promise<{ readonly page: Page; readonly result: BrowserActionResult }> {
  const startedAt = new Date();
  let page = currentPage;
  let screenshot: string | undefined;
  try {
    const locator = step.selector ? locatorFor(page, step.selector) : undefined;
    switch (step.action) {
      case "open":
      case "navigate":
        await page.goto(siteUrl(site, step.path ?? "/"));
        break;
      case "reload": await page.reload(); break;
      case "goBack": await page.goBack(); break;
      case "goForward": await page.goForward(); break;
      case "click": await required(locator, step).click(); break;
      case "doubleClick": await required(locator, step).dblclick(); break;
      case "hover": await required(locator, step).hover(); break;
      case "fill": await required(locator, step).fill(String(step.value ?? "")); break;
      case "fillForm": await fillForm(page, step.values ?? {}); break;
      case "select": await required(locator, step).selectOption(step.option); break;
      case "check": await required(locator, step).check(); break;
      case "uncheck": await required(locator, step).uncheck(); break;
      case "submit":
        await required(locator, step).evaluate((element) => {
          if (element instanceof HTMLFormElement) element.requestSubmit();
          else element.closest("form")?.requestSubmit();
        });
        break;
      case "wait": await page.waitForTimeout(step.timeoutMs ?? 0); break;
      case "waitForRequest":
        await page.waitForRequest((request) =>
          matchesRequest(request.url(), request.method(), step.url ?? "", step.method));
        break;
      case "waitForResponse":
        await page.waitForResponse((response) =>
          matchesRequest(response.url(), response.request().method(), step.url ?? "", step.method));
        break;
      case "waitForEvent": await page.waitForEvent("popup"); break;
      case "expectVisible": await required(locator, step).waitFor({ state: "visible" }); break;
      case "expectHidden": await required(locator, step).waitFor({ state: "hidden" }); break;
      case "expectText": await expectText(required(locator, step), step.text ?? ""); break;
      case "expectUrl": await page.waitForURL(step.url ?? ""); break;
      case "expectAttribute":
        await expectAttribute(
          required(locator, step),
          step.attribute ?? "",
          String(step.value ?? ""),
        );
        break;
      case "expectRequest":
        if (!observedRequests.some((request) =>
          matchesRequest(request.url(), request.method(), step.url ?? "", step.method))) {
          throw new Error(`Expected request was not observed: ${step.method ?? "*"} ${step.url ?? ""}`);
        }
        break;
      case "setCookie":
        await page.context().addCookies([{
          name: step.attribute ?? "testy",
          value: String(step.value ?? ""),
          url: site.origin,
        }]);
        break;
      case "setLocalStorage":
        await page.evaluate(
          ([key, value]) => localStorage.setItem(key, value),
          [step.attribute ?? "testy", String(step.value ?? "")] as const,
        );
        break;
      case "openTab": {
        const name = step.tab ?? `tab-${pages.size + 1}`;
        page = await page.context().newPage();
        pages.set(name, page);
        if (step.path) await page.goto(siteUrl(site, step.path));
        break;
      }
      case "switchTab": {
        const selected = pages.get(step.tab ?? "");
        if (!selected) throw new Error(`Unknown browser tab '${step.tab}'.`);
        page = selected;
        break;
      }
      case "closeTab": {
        const closed = page;
        await closed.close();
        for (const [name, candidate] of pages) {
          if (candidate === closed) pages.delete(name);
        }
        const fallback = pages.get("main") ?? [...pages.values()][0];
        if (!fallback) throw new Error("No browser tab remains open.");
        page = fallback;
        break;
      }
      case "screenshot":
        screenshot = await captureScreenshot(page, screenshotPath);
        break;
    }
    return { page, result: actionResult(step, startedAt, "passed", page.url(), undefined, screenshot) };
  } catch (error) {
    return {
      page,
      result: actionResult(
        step,
        startedAt,
        "failed",
        page.isClosed() ? undefined : page.url(),
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

async function launchBrowser(name: BrowserRunnerOptions["browser"], headless: boolean): Promise<Browser> {
  if (name === "firefox") return firefox.launch({ headless });
  if (name === "webkit") return webkit.launch({ headless });
  return chromium.launch({ headless });
}

async function applySession(
  context: BrowserContext,
  journey: ResolvedJourney,
  site: SyntheticSiteBinding,
): Promise<void> {
  const cookies = journey.persona.session?.cookies ?? [];
  if (cookies.length > 0) {
    await context.addCookies(cookies.map((cookie) => ({ ...cookie, domain: site.hostname })));
  }
  const storageEntries = Object.values(journey.persona.session?.localStorage ?? {})[0];
  if (storageEntries) {
    await context.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    }, storageEntries);
  }
}

function attachObservers(
  context: BrowserContext,
  consoleEntries: BrowserConsoleEntry[],
  requests: BrowserRequestEntry[],
): void {
  context.on("console", (message) => {
    consoleEntries.push({
      timestamp: new Date().toISOString(),
      type: message.type(),
      text: message.text(),
    });
  });
  context.on("requestfailed", (request) => {
    requests.push({
      timestamp: new Date().toISOString(),
      method: request.method(),
      urlFingerprint: fingerprintUrl(request.url()),
      failed: true,
      ...(request.failure()?.errorText ? { failureText: request.failure()?.errorText } : {}),
    });
  });
  context.on("response", (response) => {
    requests.push({
      timestamp: new Date().toISOString(),
      method: response.request().method(),
      urlFingerprint: fingerprintUrl(response.url()),
      status: response.status(),
      failed: response.status() >= 400,
    });
  });
}

async function fillForm(
  page: Page,
  values: Readonly<Record<string, string | boolean>>,
): Promise<void> {
  for (const [name, value] of Object.entries(values)) {
    const field = page.locator(`[name=${JSON.stringify(name)}]`);
    if (typeof value === "boolean") await field.setChecked(value);
    else await field.fill(value);
  }
}

async function expectText(locator: Locator, expected: string): Promise<void> {
  const actual = await locator.textContent();
  if (!(actual ?? "").includes(expected)) {
    throw new Error(`Expected text '${expected}', observed '${String(actual)}'.`);
  }
}

async function expectAttribute(locator: Locator, name: string, expected: string): Promise<void> {
  const actual = await locator.getAttribute(name);
  if (actual !== expected) {
    throw new Error(`Expected attribute '${name}' to equal '${expected}', observed '${String(actual)}'.`);
  }
}

function required(locator: Locator | undefined, step: JourneyActionDefinition): Locator {
  if (!locator) throw new Error(`Action '${step.action}' requires a selector.`);
  return locator;
}

function actionResult(
  step: JourneyActionDefinition,
  startedAt: Date,
  status: "passed" | "failed",
  pageUrl?: string,
  error?: string,
  screenshotPath?: string,
): BrowserActionResult {
  const completed = new Date();
  return {
    stepId: step.id,
    action: step.action,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completed.toISOString(),
    durationMs: completed.getTime() - startedAt.getTime(),
    ...(pageUrl ? { pageUrl } : {}),
    ...(error ? { error } : {}),
    ...(screenshotPath ? { screenshotPath } : {}),
  };
}

function siteUrl(site: SyntheticSiteBinding, path: string): string {
  return new URL(path, `${site.origin}/`).toString();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Browser journey cancelled.");
  }
}
