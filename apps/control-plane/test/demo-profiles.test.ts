import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadDemoProfileCatalog,
  selectDemoVisitor,
} from "../src/demo-profiles.js";

const customersRoot = resolve(import.meta.dirname, "../../../customers");

describe("interactive demo visitor profiles", () => {
  it("loads only synthetic identities and exposes the required initial cases", async () => {
    const catalog = await loadDemoProfileCatalog(customersRoot);
    expect(catalog.networks.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "nordlicht-corporate",
        "acme-corporate",
        "residential-anonymous",
        "vpn-anonymous",
        "hosting-anonymous",
        "unknown-anonymous",
      ]),
    );
    expect(catalog.people.map((item) => item.id)).toEqual(
      expect.arrayContaining(["alex-sales", "maya-schmidt", "sarah-demo"]),
    );
    for (const person of catalog.people) {
      expect(person.email.endsWith(".test")).toBe(true);
    }
  });

  it("allows same-company different-person composition without duplicating the network", async () => {
    const catalog = await loadDemoProfileCatalog(customersRoot);
    const alex = selectDemoVisitor(
      catalog,
      "nordlicht-corporate",
      "alex-sales",
      "new",
    );
    const maya = selectDemoVisitor(
      catalog,
      "nordlicht-corporate",
      "maya-schmidt",
      "returning",
    );

    expect(alex.network.syntheticIp).toBe("198.51.100.10");
    expect(maya.network.syntheticIp).toBe(alex.network.syntheticIp);
    expect(maya.person?.providerProfile).toBe("nordlicht-maya");
    expect(maya.person?.id).not.toBe(alex.person?.id);
  });

  it("supports a distinct synthetic company and anonymous network classes", async () => {
    const catalog = await loadDemoProfileCatalog(customersRoot);
    const acme = selectDemoVisitor(
      catalog,
      "acme-corporate",
      "sarah-demo",
      "clean",
    );
    expect(acme.network.syntheticIp).toBe("198.51.100.11");
    expect(acme.network.companyId).toBe("acme");

    for (const networkId of [
      "residential-anonymous",
      "vpn-anonymous",
      "hosting-anonymous",
      "unknown-anonymous",
    ]) {
      const selected = selectDemoVisitor(
        catalog,
        networkId,
        undefined,
        "new",
      );
      expect(selected.person).toBeUndefined();
    }
  });

  it("rejects a person from a different company", async () => {
    const catalog = await loadDemoProfileCatalog(customersRoot);
    expect(() =>
      selectDemoVisitor(
        catalog,
        "nordlicht-corporate",
        "sarah-demo",
        "new",
      ),
    ).toThrow(/does not belong/u);
  });
});
