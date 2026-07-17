import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ResolvedJourney } from "@testy/browser-config";
import type { JourneyActionDefinition } from "@testy/browser-schema";
import type { SyntheticSiteBinding } from "@testy/synthetic-site-host";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
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
    browser = await browserType(browserName).launch({ headless: options.headless ?? true });
    context = await browser.newContext({
      locale: journey.persona.browser.locale,
      timezoneId: journey.persona.browser.timezoneId,
      colorScheme: journey.persona.browser.colorScheme,
      viewport: journey.persona.browser.viewport,
      serviceWorkers: "block",
    });
    context.setDefaultTimeout(journey.timeoutMs);
    context.selectors.setTestIdAttribute("data-test");
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
    const expectedRequests: Request[] = [];
    context.on("request", (request) => expectedRequests.push(request));

    for (const step of journey.steps) {
      throwIfAborted(options.signal);
      const result = await executeStep(
        step,
        page,
        pages,
        expectedRequests,
        site,
        workspace.screenshotPath(step.id),
      );
      actions.push(result.action);
      page = result.page;
      if (result.action.screenshotPath) screenshots.push(result.action.screenshotPath);
      if (result.action.status === "failed") {
        reportError = result.action.error;
        if (shouldCapture(journey.artifactPolicy.screenshot, true)) {
          const failurePath = workspace.screenshotPath(`${step.id}-failure`);
          try {
            screenshots.push(await captureScreenshot(page, failurePath));
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
  observedRequests: Request[],
  site: SyntheticSiteBinding,
  screenshotPath: string,
): Promise<{ readonly page: Page; readonly action: BrowserActionResult }> {
  const startedAt = new Date();
  let page = currentPage;
  let capturedScreenshot: string | undefined;
  try {
    const locator = step.selector ? locatorFor(page, step.selector) : undefined;
    switch (step.action) {
      case "open":
      case "navigate":
        await page.goto(resolveSiteUrl(site, step.path ?? "/"));
        break;
      case "reload": await page.reload(); break;
      case "goBack": await page.goBack(); break;
      case "goForward": await page.goForward(); break;
      case "click": await requireLocator(locator, step).click(); break;
      case "doubleClick": await requireLocator(locator, step).dblclick(); break;
      case "hover": await requireLocator(locator, step).hover(); break;
      case "fill": await requireLocator(locator, step).fill(String(step.value ?? "")); break;
      case "fillForm":
        for (const [name, value] of Object.entries(step.values ?? {})) {
          const field = page.locator(`[name=${JSON.stringify(name)}]`);
          if (typeof value === "boolean") await field.setChecked(value);
          else await field.fill(value);
        }
        break;
      case "select": await requireLocator(locator, step).selectOption(step.option); break;
      case "check": await requireLocator(locator, step).check(); break;
      case "uncheck": await requireLocator(locator, step).uncheck(); break;
      case "submit": await requireLocator(locator, step).evaluate((element) => {
        if (element instanceof HTMLFormElement) element.requestSubmit();
        else element.closest("form")?.requestSubmit();
      }); break;
      case "wait": await page.waitForTimeout(step.timeoutMs ?? 0); break;
      case "waitForRequest": await page.waitForRequest((request) =>
        matchesRequest(request.url(), request.method(), step.url ?? "", step.method)); break;
      case "waitForResponse": await page.waitForResponse((response) =>
        matchesRequest(response.url(), response.request().method(), step.url ?? "", step.method)); break;
      case "waitForEvent": await page.waitForEvent(step.event as "popup"); break;
      case "expectVisible": await requireLocator(locator, step).waitFor({ state: "visible" }); break;
      case "expectHidden": await requireLocator(locator, step).waitFor({ state: "hidden" }); break;
      case "expectText": {
        const actual = await requireLocator(locator, step).textContent();
        if (!(actual ?? "").includes(step.text ?? "")) throw new Error(`Expected text '${step.text}', observed '${actual}'.`);
        break;
      }
      case "expectUrl":
        await page.waitForURL(step.url ?? "");
        break;
      case "expectAttribute": {
        const actual = await requireLocator(locator, step).getAttribute(step.attribute ?? "");
        if (actual !== String(step.value ?? "")) throw new Error(`Expected attribute '${step.attribute}' to equal '${String(step.value)}', observed '${String(actual)}'.`);
        break;
      }
      case "expectRequest":
        if (!observedRequests.some((request) => matchesRequest(request.url(), request.method(), step.url ?? "", step.method))) {
          throw new Error(`Expected request was not observed: ${step.method ?? "*"} ${step.url ?? ""}`);
        }
        break;
      case "setCookie":
        await page.context().addCookies([{ name: step.attribute ?? "testy", value: String(step.value ?? ""), url: site.origin }]);
        break;
      case "setLocalStorage":
        await page.evaluate(([key, value]) => localStorage.setItem(key, value), [step.attribute ?? "testy", String(step.value ?? "")]);
        break;
      case "openTab": {
        const tab = step.tab ?? `tab-${pages.size + 1}`;
        const next = await page.context().newPage();
        pages.set(tab, next);
        page = next;
        if (step.path) await page.goto(resolveSiteUrl(site, step.path));
        break;
      }
      case "switchTab": {
        const next = pages.get(step.tab ?? "");
        if (!next) throw new Error(`Unknown browser tab '${step.tab}'.`);
        page = next;
        break;
      }
      case "closeTab":
        await page.close();
        page = pages.get("main") ?? [...pages.values()].find((candidate) => !candidate.isClosed()) ?? page;
        break;
      case "screenshot":
        capturedScreenshot = await captureScreenshot(page, screenshotPath);
        break;
    }
    return {
      page,
      action: actionResult(step, startedAt, "passed", page.url(), undefined, capturedScreenshot),
    };
  } catch (error) {
    return {
      page,
      action: actionResult(
        step,
        startedAt,
        "failed",
        page.url(),
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

function actionResult(
  step: JourneyActionDefinition,
  startedAt: Date,
  status: "passed" | "failed",
  pageUrl: string,
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

async function applySession(
  context: BrowserContext,
  journey: ResolvedJourney,
  site: SyntheticSiteBinding,
): Promise<void> {
  const cookies = journey.persona.session?.cookies ?? [];
  if (cookies.length > 0) {
    await context.addCookies(cookies.map((cookie) => ({ ...cookie, domain: site.hostname })));
  }
  const storage = journey.persona.session?.localStorage ?? {};
  if (Object.keys(storage).length > 0) {
    await context.addInitScript((values) => {
      const entries = values[location.origin];
      if (entries) for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    }, storage);
  }
}

function attachObservers(
  context: BrowserContext,
  consoleEntries: BrowserConsoleEntry[],
  requests: BrowserRequestEntry[],
): void {
  context.on("console", (message) => {
    consoleEntries.push({ timestamp: new Date().toISOString(), type: message.type(), text: message.text() });
  });
  context.on("requestfailed", (request) => {
    requests.push({
      timestamp: new Date().toISOString(),
      method: request.method(),
      urlFingerprint: fingerprintUrl(request.url()),
      failed: true,
      failureText: request.failure()?.errorText,
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

function requireLocator(locator: ReturnType<typeof locatorFor> | undefined, step: JourneyActionDefinition) {
  if (!locator) throw new Error(`Action '${step.action}' requires a selector.`);
  return locator;
}

function browserType(name: BrowserRunnerOptions["browser"]): BrowserType {
  if (name === "firefox") return firefox;
  if (name === "webkit") return webkit;
  return chromium;
}

function resolveSiteUrl(site: SyntheticSiteBinding, path: string): string {
  return new URL(path, `${site.origin}/`).toString();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Browser journey cancelled.");
}
