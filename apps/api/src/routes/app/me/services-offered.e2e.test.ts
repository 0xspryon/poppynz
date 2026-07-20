import {
  EmptyApprovalRepoTest,
  EmptyApprovalRequestRepoTest,
  EmptyKycDocumentRepoTest,
  EmptyKycDocumentTypeRepoTest,
  EmptySignupIntentRepoTest,
  EmptyUserProfileRepoTest,
  DBNotFoundError,
  makeServiceOfferedRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type ServiceOffered,
  type ServiceOfferedCreateInput,
  type ServiceOfferedUpdateInput,
  type Session,
  type User,
} from "@repo/db";
import { makeGooglePlacesTest } from "@repo/google";
import { Effect, Layer, ManagedRuntime } from "effect";
import { makeObjectStorageTest } from "@repo/objs";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../index";
import { makeAuthServiceTest, type AuthSession } from "../../../lib/effect-auth";
import { EmptySigninServiceTest } from "../auth/signin/signin.handler";
import { EmptySignupServiceTest } from "../auth/signup/signup.handler";

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "provider-1",
  name: "Provider User",
  email: "provider@example.com",
  emailVerified: true,
  image: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  isAnonymous: false,
  role: "service-provider",
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null,
  ...overrides,
});

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  expiresAt: new Date("2026-06-13T00:00:00.000Z"),
  token: "session-token",
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ipAddress: null,
  userAgent: null,
  userId: "provider-1",
  impersonatedBy: null,
  activeOrganizationId: null,
  ...overrides,
});

const makeService = (input: ServiceOfferedCreateInput, overrides: Partial<ServiceOffered> = {}): ServiceOffered => ({
  id: overrides.id ?? `service-${crypto.randomUUID()}`,
  userId: input.userId,
  catalogueServiceId: input.catalogueServiceId ?? null,
  name: input.name,
  description: input.description ?? null,
  hourlyRateCents: input.hourlyRateCents,
  currency: input.currency,
  deletedAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const makeInMemoryServiceRepo = (services: Array<ServiceOffered>) => ({
  listByUserId: (userId: string) => Effect.succeed(services.filter((service) => service.userId === userId && service.deletedAt === null)),
  findByIdForUser: (id: string, userId: string) => {
    const service = services.find((service) => service.id === id && service.userId === userId && service.deletedAt === null);
    return service ? Effect.succeed(service) : Effect.fail(new DBNotFoundError({ entity: "serviceOffered", value: id }));
  },
  create: (input: ServiceOfferedCreateInput) => {
    const service = makeService(input, { id: "service-1" });
    services.push(service);
    return Effect.succeed(service);
  },
  updateByIdForUser: (id: string, userId: string, input: ServiceOfferedUpdateInput) => {
    const service = services.find((service) => service.id === id && service.userId === userId && service.deletedAt === null);
    if (!service) return Effect.fail(new DBNotFoundError({ entity: "serviceOffered", value: id }));
    Object.assign(service, input, { updatedAt: new Date("2026-06-12T00:00:00.000Z") });
    return Effect.succeed(service);
  },
  softDeleteByIdForUser: (id: string, userId: string) => {
    const service = services.find((service) => service.id === id && service.userId === userId && service.deletedAt === null);
    if (!service) return Effect.fail(new DBNotFoundError({ entity: "serviceOffered", value: id }));
    service.deletedAt = new Date("2026-06-12T00:00:00.000Z");
    return Effect.succeed(service);
  },
});

const makeApp = (options: { authSession?: AuthSession | null; hasPermission?: boolean; user?: User; services?: Array<ServiceOffered> } = {}) => {
  const user = options.user ?? makeUser();
  const authSession = options.authSession === undefined ? { user: { id: user.id }, session: { id: "session-1" } } : options.authSession;
  const services = options.services ?? [];
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      makeAuthServiceTest({
        getSession: () => Effect.succeed(authSession),
        userHasPermission: () => Effect.succeed(options.hasPermission ?? true),
      }),
      EmptySignupIntentRepoTest,
      EmptySigninServiceTest,
      EmptySignupServiceTest,
      EmptyUserProfileRepoTest,
      EmptyApprovalRepoTest,
      EmptyApprovalRequestRepoTest,
      EmptyKycDocumentRepoTest,
      EmptyKycDocumentTypeRepoTest,
      makeGooglePlacesTest({ lookupPlaceById: () => Effect.die("not used") }),
      makeObjectStorageTest({
        ensureBucketExists: () => Effect.void,
        ensurePublicReadBucket: () => Effect.void,
        createPresignedPutUrl: () => Effect.succeed({ uploadUrl: "https://example.com", expiresAt: new Date() }),
      }),
      makeServiceOfferedRepoTest(makeInMemoryServiceRepo(services)),
      makeUserRepoTest({
        findById: (id) => id === user.id ? Effect.succeed(user) : Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
        findByEmail: () => Effect.succeed(user),
      }),
      makeSessionRepoTest({
        findById: (id) => id === "session-1" ? Effect.succeed(makeSession({ userId: user.id })) : Effect.fail(new DBNotFoundError({ entity: "session", value: id })),
      }),
    ),
  );

  return createApp(runtime);
};

describe("/me/services-offered", () => {
  it("lets a service provider create and list services offered", async () => {
    const services: Array<ServiceOffered> = [];
    const app = makeApp({ services });

    const createRes = await app.request("/api/v1/me/services-offered", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "After school babysitting", hourlyRateCents: 2800, currency: "CAD" }),
    });

    expect(createRes.status).toBe(200);
    expect((await createRes.json()).name).toBe("After school babysitting");

    const listRes = await app.request("/api/v1/me/services-offered");
    const body = await listRes.json();

    expect(listRes.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].hourlyRateCents).toBe(2800);
  });

  it("rejects users without service-offered write permission", async () => {
    const app = makeApp({ user: makeUser({ role: "family" }), hasPermission: false });

    const res = await app.request("/api/v1/me/services-offered", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "After school babysitting", hourlyRateCents: 2800, currency: "CAD" }),
    });

    expect(res.status).toBe(403);
  });

  it("soft deletes services using deletedAt", async () => {
    const service = makeService({ userId: "provider-1", name: "Weekend childcare", hourlyRateCents: 3000, currency: "CAD" }, { id: "service-1" });
    const services = [service];
    const app = makeApp({ services });

    const deleteRes = await app.request("/api/v1/me/services-offered/service-1", { method: "DELETE" });
    const deleted = await deleteRes.json();

    expect(deleteRes.status).toBe(200);
    expect(deleted.deletedAt).toBe("2026-06-12T00:00:00.000Z");

    const listRes = await app.request("/api/v1/me/services-offered");
    expect(await listRes.json()).toEqual([]);
  });
});
