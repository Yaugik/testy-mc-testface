import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ValidateFunction } from "ajv";
import {
  type BrowserSelector,
  type CustomerConfig,
  type FragmentConfig,
  type JourneyActionDefinition,
  type JourneyConfig,
  type JourneyStepDefinition,
  type LoadedBrowserPackage,
  type PersonaConfig,
  type SiteBlockDefinition,
  type SiteConfig,
} from "@testy/browser-schema";
import { parseDocument } from "yaml";

import {
  BrowserPackageValidationError,
  type BrowserConfigIssue,
} from "./errors.js";
import { hashBrowserPackage } from "./hash.js";
import { createBrowserSchemaRegistry } from "./schema-registry.js";

interface LoadedSource<T> {
  readonly filePath: string;
  readonly relativePath: string;
  readonly content: string;
  readonly value: T;
}

const selectorActions = new Set<JourneyActionDefinition["action"]>([
  "click",
  "doubleClick",
  "hover",
  "fill",
  "select",
  "check",
  "uncheck",
  "submit",
  "expectVisible",
  "expectHidden",
  "expectText",
  "expectAttribute",
]);

const positionalCssPattern =
  /(?:^|[^a-z-]):(?:nth-child|nth-of-type|first-child|last-child|first-of-type|last-of-type)\b|(?:^|\s)(?:xpath=|\/\/)/iu;

export async function loadBrowserPackage(
  packagePath: string,
): Promise<LoadedBrowserPackage> {
  const rootDir = resolve(packagePath);
  const registry = await createBrowserSchemaRegistry();
  const issues: BrowserConfigIssue[] = [];
  const customer = await loadDocument(
    rootDir,
    "customer.yaml",
    registry.customer,
    issues,
  );
  if (!customer) {
    throw new BrowserPackageValidationError(issues);
  }

  const site = await loadDocument(rootDir, customer.value.site, registry.site, issues);
  const personas = await loadDocuments(
    rootDir,
    customer.value.personas,
    registry.persona,
    issues,
  );
  const journeys = await loadDocuments(
    rootDir,
    customer.value.journeys,
    registry.journey,
    issues,
  );
  const fragments = await loadDocuments(
    rootDir,
    customer.value.fragments ?? [],
    registry.fragment,
    issues,
  );

  if (
    !site ||
    personas.length !== customer.value.personas.length ||
    journeys.length !== customer.value.journeys.length
  ) {
    throw new BrowserPackageValidationError(issues);
  }

  validateSemantics(
    customer.value,
    site.value,
    personas.map((item) => item.value),
    journeys.map((item) => item.value),
    fragments.map((item) => item.value),
    issues,
  );
  if (issues.length > 0) {
    throw new BrowserPackageValidationError(issues);
  }

  const sources = [customer, site, ...personas, ...journeys, ...fragments];
  return {
    rootDir,
    customer: customer.value,
    site: site.value,
    personas: personas.map((item) => item.value),
    journeys: journeys.map((item) => item.value),
    fragments: fragments.map((item) => item.value),
    contentHash: hashBrowserPackage(
      sources.map(({ relativePath, content }) => ({ relativePath, content })),
    ),
  };
}

async function loadDocuments<T>(
  rootDir: string,
  paths: readonly string[],
  validator: ValidateFunction<T>,
  issues: BrowserConfigIssue[],
): Promise<LoadedSource<T>[]> {
  const values: LoadedSource<T>[] = [];
  for (const path of paths) {
    const loaded = await loadDocument(rootDir, path, validator, issues);
    if (loaded) {
      values.push(loaded);
    }
  }
  return values;
}

async function loadDocument<T>(
  rootDir: string,
  relativePath: string,
  validator: ValidateFunction<T>,
  issues: BrowserConfigIssue[],
): Promise<LoadedSource<T> | undefined> {
  let filePath: string;
  try {
    filePath = safeResolve(rootDir, relativePath);
  } catch (error) {
    issues.push({
      code: "package-invalid",
      message: error instanceof Error ? error.message : String(error),
      instancePath: relativePath,
    });
    return undefined;
  }

  try {
    const content = await readFile(filePath, "utf8");
    const document = parseDocument(content, {
      merge: false,
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) {
      issues.push(
        ...document.errors.map((error) => ({
          code: "yaml-invalid" as const,
          message: error.message,
          filePath,
        })),
      );
      return undefined;
    }
    const value = document.toJS({ maxAliasCount: 0 }) as unknown;
    if (!validator(value)) {
      issues.push(
        ...(validator.errors ?? []).map((error) => ({
          code: "schema-invalid" as const,
          message: error.message ?? "is invalid",
          filePath,
          instancePath: error.instancePath || "/",
        })),
      );
      return undefined;
    }
    return {
      filePath,
      relativePath: normalizePath(relative(rootDir, filePath)),
      content,
      value,
    };
  } catch (error) {
    issues.push({
      code: "package-invalid",
      message: `Unable to load '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
      filePath,
    });
    return undefined;
  }
}

function validateSemantics(
  customer: CustomerConfig,
  site: SiteConfig,
  personas: readonly PersonaConfig[],
  journeys: readonly JourneyConfig[],
  fragments: readonly FragmentConfig[],
  issues: BrowserConfigIssue[],
): void {
  const personaIds = uniqueIds(
    personas.map((item) => item.persona.id),
    "persona",
    issues,
  );
  const fragmentIds = uniqueIds(
    fragments.map((item) => item.fragment.id),
    "fragment",
    issues,
  );
  uniqueIds(journeys.map((item) => item.journey.id), "journey", issues);
  for (const persona of personas) {
    for (const cookie of persona.session?.cookies ?? []) {
      validateSyntheticHostname(
        cookie.domain.replace(/^\./u, ""),
        `cookie '${cookie.name}'`,
        issues,
      );
    }
    for (const origin of Object.keys(persona.session?.localStorage ?? {})) {
      validateSyntheticUrl(
        origin,
        `localStorage origin for persona '${persona.persona.id}'`,
        issues,
      );
    }
  }

  const paths = new Set<string>();
  const testIds = new Set<string>();
  if (site.consent) {
    addTestId("consent-banner", testIds, issues);
    addTestId(site.consent.acceptTestId, testIds, issues);
    addTestId(site.consent.rejectTestId, testIds, issues);
  }
  for (const page of site.pages) {
    if (paths.has(page.path)) {
      issues.push({ code: "package-invalid", message: `Duplicate site path '${page.path}'.` });
    }
    paths.add(page.path);
    uniqueIds(page.blocks.map((block) => block.id), `block on ${page.path}`, issues);
    for (const block of page.blocks) {
      collectBlockTestIds(block, testIds, issues);
      validateLink(block, issues);
    }
  }

  for (const journey of journeys) {
    if (!personaIds.has(journey.persona)) {
      issues.push({
        code: "package-invalid",
        message: `Journey '${journey.journey.id}' references unknown persona '${journey.persona}'.`,
      });
    }
    if (!paths.has(journey.startPath)) {
      issues.push({
        code: "package-invalid",
        message: `Journey '${journey.journey.id}' startPath '${journey.startPath}' is not a site page.`,
      });
    }
    validateSteps(journey.steps, journey, fragmentIds, testIds, issues);
    uniqueIds(journey.steps.map((step) => step.id), `step in ${journey.journey.id}`, issues);
    for (const fixture of journey.networkFixtures ?? []) {
      validateSyntheticUrl(fixture.match.url, `network fixture '${fixture.id}'`, issues);
    }
  }

  for (const fragment of fragments) {
    const pseudoJourney: JourneyConfig = {
      schemaVersion: "1.0",
      journey: {
        id: fragment.fragment.id,
        displayName: fragment.fragment.displayName,
      },
      persona: personas[0]?.persona.id ?? "missing-persona",
      startPath: site.pages[0]?.path ?? "/",
      allowCssFallback: false,
      steps: fragment.steps,
    };
    validateSteps(fragment.steps, pseudoJourney, fragmentIds, testIds, issues);
    uniqueIds(
      fragment.steps.map((step) => step.id),
      `fragment step in ${fragment.fragment.id}`,
      issues,
    );
  }

  if (customer.customer.id === site.site.id) {
    issues.push({
      code: "package-invalid",
      message:
        "Customer and site IDs must be distinct to avoid artifact namespace collisions.",
    });
  }
}

function validateSteps(
  steps: readonly JourneyStepDefinition[],
  journey: JourneyConfig,
  fragmentIds: ReadonlySet<string>,
  availableTestIds: ReadonlySet<string>,
  issues: BrowserConfigIssue[],
): void {
  for (const step of steps) {
    if ("useFragment" in step) {
      if (!fragmentIds.has(step.useFragment)) {
        issues.push({
          code: "package-invalid",
          message: `Step '${step.id}' references unknown fragment '${step.useFragment}'.`,
        });
      }
      continue;
    }
    if (selectorActions.has(step.action) && !step.selector) {
      issues.push({
        code: "package-invalid",
        message: `Action '${step.action}' in step '${step.id}' requires a selector.`,
      });
    }
    if (step.selector) {
      validateSelector(step.selector, journey, step.id, availableTestIds, issues);
    }
    validateActionFields(step, issues);
  }
}

function validateActionFields(
  step: JourneyActionDefinition,
  issues: BrowserConfigIssue[],
): void {
  const missing = (field: string): void => {
    issues.push({
      code: "package-invalid",
      message: `Action '${step.action}' in step '${step.id}' requires '${field}'.`,
    });
  };
  switch (step.action) {
    case "navigate":
      if (!step.path) missing("path");
      break;
    case "fill":
      if (typeof step.value !== "string") missing("value");
      break;
    case "fillForm":
      if (!step.values) missing("values");
      break;
    case "select":
      if (!step.option) missing("option");
      break;
    case "wait":
      if (step.timeoutMs === undefined) missing("timeoutMs");
      break;
    case "waitForRequest":
    case "waitForResponse":
    case "expectRequest":
    case "expectUrl":
      if (!step.url) missing("url");
      break;
    case "waitForEvent":
      if (!step.event) missing("event");
      break;
    case "expectText":
      if (step.text === undefined) missing("text");
      break;
    case "expectAttribute":
      if (!step.attribute) missing("attribute");
      if (step.value === undefined) missing("value");
      break;
    case "switchTab":
      if (!step.tab) missing("tab");
      break;
    default:
      break;
  }
}

function validateSelector(
  selector: BrowserSelector,
  journey: JourneyConfig,
  stepId: string,
  availableTestIds: ReadonlySet<string>,
  issues: BrowserConfigIssue[],
): void {
  if ("testId" in selector && !availableTestIds.has(selector.testId)) {
    issues.push({
      code: "package-invalid",
      message: `Step '${stepId}' references unknown data-test value '${selector.testId}'.`,
    });
  }
  if (!("css" in selector)) {
    return;
  }
  if (!journey.allowCssFallback) {
    issues.push({
      code: "package-invalid",
      message: `Step '${stepId}' uses CSS without allowCssFallback: true.`,
    });
  }
  if (positionalCssPattern.test(selector.css)) {
    issues.push({
      code: "package-invalid",
      message: `Step '${stepId}' uses a prohibited positional or XPath selector.`,
    });
  }
}

function collectBlockTestIds(
  block: SiteBlockDefinition,
  testIds: Set<string>,
  issues: BrowserConfigIssue[],
): void {
  addTestId(block.testId, testIds, issues);
  if (block.type !== "form") {
    return;
  }
  addTestId(block.submit.testId, testIds, issues);
  uniqueIds(block.fields.map((field) => field.id), `field in ${block.id}`, issues);
  for (const field of block.fields) {
    addTestId(field.testId, testIds, issues);
  }
}

function addTestId(
  testId: string | undefined,
  testIds: Set<string>,
  issues: BrowserConfigIssue[],
): void {
  if (!testId) {
    return;
  }
  if (testIds.has(testId)) {
    issues.push({ code: "package-invalid", message: `Duplicate data-test value '${testId}'.` });
  }
  testIds.add(testId);
}

function validateLink(
  block: SiteBlockDefinition,
  issues: BrowserConfigIssue[],
): void {
  if (block.type !== "link") {
    return;
  }
  validateSyntheticUrl(block.href, `link '${block.id}'`, issues);
}

function validateSyntheticHostname(
  hostname: string,
  label: string,
  issues: BrowserConfigIssue[],
): void {
  if (!/\.(?:test|example|invalid)$/iu.test(hostname)) {
    issues.push({
      code: "package-invalid",
      message: `${label} must use an approved synthetic hostname.`,
    });
  }
}

function validateSyntheticUrl(
  value: string,
  label: string,
  issues: BrowserConfigIssue[],
): void {
  if (value.startsWith("/")) {
    return;
  }
  try {
    const url = new URL(value);
    if (!/\.(?:test|example|invalid)$/iu.test(url.hostname)) {
      issues.push({
        code: "package-invalid",
        message: `${label} must use a relative URL or an approved synthetic hostname.`,
      });
    }
  } catch {
    issues.push({ code: "package-invalid", message: `${label} contains an invalid URL.` });
  }
}

function uniqueIds(
  values: readonly string[],
  label: string,
  issues: BrowserConfigIssue[],
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const value of values) {
    if (result.has(value)) {
      issues.push({ code: "package-invalid", message: `Duplicate ${label} ID '${value}'.` });
    }
    result.add(value);
  }
  return result;
}

function safeResolve(rootDir: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error(`Browser package path '${relativePath}' must be relative.`);
  }
  const destination = resolve(rootDir, relativePath);
  const relativeDestination = relative(rootDir, destination);
  if (
    relativeDestination === ".." ||
    relativeDestination.startsWith(`..${sep}`) ||
    isAbsolute(relativeDestination)
  ) {
    throw new Error(`Browser package path '${relativePath}' escapes the package root.`);
  }
  return destination;
}

function normalizePath(value: string): string {
  return value.split(sep).join("/");
}
