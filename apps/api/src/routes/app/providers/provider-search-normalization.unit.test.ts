import type { ProviderSearchCandidate } from "@repo/db";
import { buildFilter, buildProviderSearchDocument } from "@repo/typesense";
import { describe, expect, it } from "vitest";

const candidate = (): ProviderSearchCandidate => ({
  profile: {
    userId: "provider-1",
    language: "en",
    firstName: "Maria",
    lastName: "Santos",
    gender: null,
    phoneNumber: null,
    dateOfBirth: null,
    address: null,
    city: "Port Credit",
    postalCode: null,
    country: "Canada",
    stateProvince: "Ontario",
    shortBio: "Newborn specialist",
    googlePlaceId: null,
    latitude: 43.55,
    longitude: -79.58,
    image: null,
    email: "maria@example.com",
    role: "service-provider",
    banned: false,
    banExpires: null,
  },
  approval: {
    id: "00000000-0000-7000-8000-000000000001",
    userId: "provider-1",
    approvalRequestId: "00000000-0000-7000-8000-000000000002",
    approvedBy: "admin-1",
    expiresAt: new Date(Date.now() + 86_400_000),
    status: "approved",
    reason: null,
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  },
  services: [
    {
      id: "00000000-0000-7000-8000-000000000003",
      userId: "provider-1",
      catalogueServiceId: null,
      name: "Newborn Overnight Care",
      description: "Night feeds",
      hourlyRateCents: 3400,
      currency: "CAD",
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z"),
      deletedAt: null,
    },
  ],
});

describe("provider search lowercase normalization", () => {
  it("indexes lowercase matching fields while keeping display casing", () => {
    const document = buildProviderSearchDocument(candidate());

    expect(document).not.toBeNull();
    expect(document?.city).toBe("Port Credit");
    expect(document?.cityNormalized).toBe("port credit");
    expect(document?.services).toEqual(["Newborn Overnight Care"]);
    expect(document?.servicesNormalized).toEqual(["newborn overnight care"]);
  });

  it("excludes actively banned providers", () => {
    const base = candidate();
    const banned = { ...base, profile: { ...base.profile, banned: true, banExpires: null } };
    const lapsedBan = { ...base, profile: { ...base.profile, banned: true, banExpires: new Date(Date.now() - 86_400_000) } };
    const futureBan = { ...base, profile: { ...base.profile, banned: true, banExpires: new Date(Date.now() + 86_400_000) } };

    expect(buildProviderSearchDocument(banned)).toBeNull();
    expect(buildProviderSearchDocument(futureBan)).toBeNull();
    expect(buildProviderSearchDocument(lapsedBan)).not.toBeNull();
  });

  it("lowercases service and city filter inputs against the normalized fields", () => {
    const filter = buildFilter({
      service: "Newborn Overnight Care",
      city: "  PORT Credit ",
      page: 1,
      perPage: 20,
    });

    expect(filter).toContain("servicesNormalized:=`newborn overnight care`");
    expect(filter).toContain("cityNormalized:=`port credit`");
    expect(filter).not.toContain("services:=`");
    expect(filter).not.toContain("city:=`");
  });

  it("escapes filter operators in facet values so they can't inject predicates", () => {
    const filter = buildFilter({
      city: "toronto` || approvalExpiresAt:>0 || `",
      page: 1,
      perPage: 20,
    });

    // The injected backticks are escaped, so the whole payload stays one
    // literal value rather than closing the string and adding an OR clause.
    expect(filter).toContain("cityNormalized:=`toronto\\` || approvalexpiresat:>0 || \\``");
    expect(filter).not.toContain("cityNormalized:=`toronto` ");
  });
});
