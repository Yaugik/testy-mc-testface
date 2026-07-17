#!/usr/bin/env node
import { resolve } from "node:path";

import { loadBrowserPackage, resolveJourney } from "@testy/browser-config";
import { startSyntheticSite } from "@testy/synthetic-site-host";

import { runBrowserJourney } from "./runner.js";

const [
  packagePath = "customers/customer-alpha",
  journeyId = "lead-capture",
  artifactRoot = "generated/browser",
] = process.argv.slice(2);
const loaded = await loadBrowserPackage(resolve(packagePath));
const journey = resolveJourney(loaded, journeyId);
const site = await startSyntheticSite(loaded, {
  runNamespace: `browser-${Date.now()}`,
});

try {
  const report = await runBrowserJourney(journey, site, {
    artifactRoot: resolve(artifactRoot),
    runNamespace: site.runNamespace,
    browser:
      (process.env.TESTY_BROWSER as "chromium" | "firefox" | "webkit" | undefined) ??
      "chromium",
    headless: process.env.TESTY_HEADLESS !== "false",
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "passed") process.exitCode = 1;
} finally {
  await site.stop();
}
