#!/usr/bin/env node
import { resolve } from "node:path";

import { loadBrowserPackage } from "@testy/browser-config";

import { startSyntheticSite } from "./host.js";

const [packagePath = "customers/customer-alpha"] = process.argv.slice(2);
const loaded = await loadBrowserPackage(resolve(packagePath));
const binding = await startSyntheticSite(loaded, {
  runNamespace: process.env.TESTY_RUN_NAMESPACE ?? "local",
});
process.stdout.write(
  `${JSON.stringify(
    {
      siteId: binding.siteId,
      hostname: binding.hostname,
      origin: binding.origin,
      localOrigin: binding.localOrigin,
      health: `${binding.localOrigin}/__testy/health`,
    },
    null,
    2,
  )}\n`,
);

let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await binding.stop();
};
process.once("SIGINT", () => void stop().finally(() => process.exit(130)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(143)));
