#!/usr/bin/env node
import { resolve } from "node:path";

import { loadBrowserPackage } from "./loader.js";
import { resolveJourney } from "./resolver.js";

const [packagePath = "customers/customer-alpha", journeyId] = process.argv.slice(2);
const loaded = await loadBrowserPackage(resolve(packagePath));
const journeys = journeyId
  ? [resolveJourney(loaded, journeyId)]
  : loaded.journeys.map((journey) => resolveJourney(loaded, journey.journey.id));
process.stdout.write(
  `${JSON.stringify(
    {
      customerId: loaded.customer.customer.id,
      siteId: loaded.site.site.id,
      packageHash: loaded.contentHash,
      journeys: journeys.map((journey) => ({
        id: journey.journeyId,
        persona: journey.persona.persona.id,
        steps: journey.steps.length,
        contentHash: journey.contentHash,
      })),
    },
    null,
    2,
  )}\n`,
);
