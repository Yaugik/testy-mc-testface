import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isReservedSyntheticIpv4 } from "@testy/traffic-gateway";

export interface DemoNetworkIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly syntheticIp: string;
  readonly classification:
    | "corporate"
    | "residential"
    | "vpn"
    | "hosting"
    | "unknown";
  readonly country: string;
  readonly companyId?: string;
  readonly companyName?: string;
  readonly description?: string;
}

export interface DemoPersonIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly companyId: string;
  readonly name: string;
  readonly email: string;
  readonly jobTitle: string;
  readonly providerProfile: string;
}

export interface DemoBrowserIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly reset: boolean;
}

export interface DemoProfileCatalog {
  readonly networks: readonly DemoNetworkIdentity[];
  readonly people: readonly DemoPersonIdentity[];
  readonly browserIdentities: readonly DemoBrowserIdentity[];
  readonly defaults: {
    readonly networkId: string;
    readonly personId: string;
    readonly browserId: string;
  };
}

interface RawCatalog extends DemoProfileCatalog {
  readonly schemaVersion: string;
}

export async function loadDemoProfileCatalog(
  browserPackagesDirectory: string,
  customerPackage = "customer-alpha",
): Promise<DemoProfileCatalog> {
  const path = join(
    browserPackagesDirectory,
    customerPackage,
    "visitor-profiles.json",
  );
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(parsed) || parsed.schemaVersion !== "1.0") {
    throw new Error("Interactive Demo visitor catalog must use schemaVersion 1.0.");
  }
  const catalog = parsed as unknown as RawCatalog;
  if (
    !Array.isArray(catalog.networks) ||
    !Array.isArray(catalog.people) ||
    !Array.isArray(catalog.browserIdentities) ||
    !isRecord(catalog.defaults)
  ) {
    throw new Error("Interactive Demo visitor catalog is incomplete.");
  }

  const networkIds = new Set<string>();
  for (const network of catalog.networks) {
    assertId(network.id, "network");
    if (networkIds.has(network.id)) {
      throw new Error(`Duplicate network identity '${network.id}'.`);
    }
    networkIds.add(network.id);
    if (!isReservedSyntheticIpv4(network.syntheticIp)) {
      throw new Error(
        `Network identity '${network.id}' must use a documentation/reserved synthetic IPv4 address.`,
      );
    }
    if (!/^[A-Z]{2}$/u.test(network.country)) {
      throw new Error(`Network identity '${network.id}' has an invalid country code.`);
    }
    if (network.classification === "corporate" && !network.companyId) {
      throw new Error(`Corporate network '${network.id}' must reference a companyId.`);
    }
  }

  const peopleIds = new Set<string>();
  for (const person of catalog.people) {
    assertId(person.id, "person");
    if (peopleIds.has(person.id)) {
      throw new Error(`Duplicate person identity '${person.id}'.`);
    }
    peopleIds.add(person.id);
    assertId(person.companyId, "company");
    assertId(person.providerProfile, "provider profile");
    const emailDomain = person.email.split("@")[1]?.toLowerCase();
    if (!emailDomain?.endsWith(".test")) {
      throw new Error(
        `Person identity '${person.id}' must use a synthetic .test email address.`,
      );
    }
  }

  const browserIds = new Set<string>();
  for (const browser of catalog.browserIdentities) {
    assertId(browser.id, "browser");
    if (browserIds.has(browser.id)) {
      throw new Error(`Duplicate browser identity '${browser.id}'.`);
    }
    browserIds.add(browser.id);
    if (typeof browser.reset !== "boolean") {
      throw new Error(`Browser identity '${browser.id}' must declare reset semantics.`);
    }
  }

  if (!networkIds.has(catalog.defaults.networkId)) {
    throw new Error("Interactive Demo default network does not exist.");
  }
  if (!peopleIds.has(catalog.defaults.personId)) {
    throw new Error("Interactive Demo default person does not exist.");
  }
  if (!browserIds.has(catalog.defaults.browserId)) {
    throw new Error("Interactive Demo default browser identity does not exist.");
  }

  return {
    networks: catalog.networks.map((value) => ({ ...value })),
    people: catalog.people.map((value) => ({ ...value })),
    browserIdentities: catalog.browserIdentities.map((value) => ({ ...value })),
    defaults: { ...catalog.defaults },
  };
}

export function selectDemoVisitor(
  catalog: DemoProfileCatalog,
  networkId: string,
  personId: string | undefined,
  browserId: string,
): {
  readonly network: DemoNetworkIdentity;
  readonly person?: DemoPersonIdentity;
  readonly browser: DemoBrowserIdentity;
} {
  const network = catalog.networks.find((item) => item.id === networkId);
  if (!network) throw new Error(`Unknown network identity '${networkId}'.`);
  const browser = catalog.browserIdentities.find((item) => item.id === browserId);
  if (!browser) throw new Error(`Unknown browser identity '${browserId}'.`);

  const person = personId
    ? catalog.people.find((item) => item.id === personId)
    : undefined;
  if (personId && !person) {
    throw new Error(`Unknown person identity '${personId}'.`);
  }
  if (person && network.companyId !== person.companyId) {
    throw new Error(
      `Person '${person.id}' does not belong to network company '${network.companyId ?? "none"}'.`,
    );
  }
  if (!network.companyId && person) {
    throw new Error("Anonymous/non-corporate networks cannot select a person identity.");
  }

  return {
    network,
    ...(person ? { person } : {}),
    browser,
  };
}

function assertId(value: unknown, kind: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]*$/u.test(value)) {
    throw new Error(`Interactive Demo ${kind} id is invalid.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
