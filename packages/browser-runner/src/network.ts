import type { NetworkFixtureDefinition } from "@testy/browser-schema";
import type { BrowserContext, Route } from "playwright";

export interface SiteRouteBinding {
  readonly hostname: string;
  readonly port: number;
  readonly localOrigin: string;
}

export async function installSiteRoute(
  context: BrowserContext,
  binding: SiteRouteBinding,
): Promise<void> {
  await context.route(
    (url) => url.hostname === binding.hostname && Number(url.port) === binding.port,
    async (route) => {
      const source = new URL(route.request().url());
      const target = new URL(source.pathname + source.search, binding.localOrigin);
      const fetched = await route.fetch({ url: target.toString() });
      await route.fulfill({ response: fetched });
    },
  );
}

export async function installNetworkFixtures(
  context: BrowserContext,
  fixtures: readonly NetworkFixtureDefinition[],
): Promise<void> {
  for (const fixture of fixtures) {
    await context.route(fixture.match.url, async (route) => {
      if (
        fixture.match.method &&
        route.request().method().toUpperCase() !== fixture.match.method.toUpperCase()
      ) {
        await route.fallback();
        return;
      }
      if (fixture.response.delayMs) {
        await delay(fixture.response.delayMs);
      }
      await route.fulfill({
        status: fixture.response.status,
        headers: fixture.response.headers,
        body: fixture.response.body ?? "",
      });
    });
  }
}

export function matchesRequest(
  url: string,
  method: string,
  expectedUrl: string,
  expectedMethod?: string,
): boolean {
  return url === expectedUrl &&
    (expectedMethod === undefined || method.toUpperCase() === expectedMethod.toUpperCase());
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function continueRoute(route: Route): Promise<void> {
  await route.continue();
}
