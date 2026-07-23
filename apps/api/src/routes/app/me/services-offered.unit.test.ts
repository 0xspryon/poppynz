import { SqlError } from "@effect/sql/SqlError";
import {
  DBNotFoundError,
  makeServiceCatalogueRepoTest,
  makeServiceOfferedRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type ServiceCatalogueItem,
  type ServiceOffered,
  type Session,
  type User,
} from "@repo/db";
import { makeProviderSearchQueueTest } from "@repo/queue";
import { makeProviderSearchOutboxRepoTest, type ProviderSearchOutbox } from "@repo/db";
import { Cause, ConfigProvider, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { makeAuthServiceTest } from "@/api/lib/effect-auth";
import {
  createServiceOfferedRouteProgram,
  deleteServiceOfferedRouteProgram,
  listServicesOfferedRouteProgram,
  updateServiceOfferedRouteProgram,
} from "./services-offered.handler";

const user = (overrides: Partial<User> = {}): User => ({
  id: "provider-1", name: "Provider", email: "provider@example.com", emailVerified: true, image: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"), updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  isAnonymous: false, role: "service-provider", banned: false, banReason: null, banExpires: null, phoneNumber: null, phoneNumberVerified: null,
  ...overrides,
});

const session = (): Session => ({
  id: "session-1", expiresAt: new Date("2026-06-13T00:00:00.000Z"), token: "token",
  createdAt: new Date("2026-06-12T00:00:00.000Z"), updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ipAddress: null, userAgent: null, userId: "provider-1", impersonatedBy: null, activeOrganizationId: null,
});

const service = (overrides: Partial<ServiceOffered> = {}): ServiceOffered => ({
  id: "service-1", userId: "provider-1", catalogueServiceId: null, name: "Childcare", description: null, hourlyRateCents: 2500, currency: "CAD",
  createdAt: new Date("2026-06-12T00:00:00.000Z"), updatedAt: new Date("2026-06-12T00:00:00.000Z"), deletedAt: null,
  ...overrides,
});

const catalogueItem = (overrides: Partial<ServiceCatalogueItem> = {}): ServiceCatalogueItem => ({
  id: "0197b3a0-0000-7000-8000-000000000001", name: "Babysitting", category: "Childcare",
  baseHourlyRateCents: 1800, currency: "CAD", isLive: true,
  createdAt: new Date("2026-06-12T00:00:00.000Z"), updatedAt: new Date("2026-06-12T00:00:00.000Z"), deletedAt: null,
  ...overrides,
});

const contextWithJson = (body: unknown) => ({ req: { json: async () => body } }) as HonoContext<HonoEnv>;

const outbox = (userId = "provider-1"): ProviderSearchOutbox => ({
  id: "outbox-1",
  userId,
  status: "pending",
  attempts: 0,
  lastError: null,
  processedAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
});

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected effect to fail");
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error("Expected typed failure");
  return failure.value;
};

const makeLayer = (options: {
  user?: User;
  services?: Array<ServiceOffered>;
  existingService?: ServiceOffered;
  catalogueItems?: Array<ServiceCatalogueItem>;
  hasPermission?: boolean;
  createError?: SqlError;
  onCreate?: (input: { name: string; hourlyRateCents: number; catalogueServiceId?: string | null }) => void;
  onUpdate?: (input: { hourlyRateCents?: number; catalogueServiceId?: string | null }) => void;
} = {}) => {
  const currentUser = options.user ?? user();
  const currentSession = session();
  const existingService = options.existingService ?? service();
  const catalogueItems = options.catalogueItems ?? [];
  return Layer.mergeAll(
    makeServiceCatalogueRepoTest({
      listActive: () => Effect.succeed(catalogueItems),
      listLive: () => Effect.succeed(catalogueItems.filter((item) => item.isLive)),
      findActiveById: (id) => {
        const item = catalogueItems.find((candidate) => candidate.id === id && candidate.deletedAt === null);
        return item ? Effect.succeed(item) : Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: id }));
      },
      findById: (id) => {
        const item = catalogueItems.find((candidate) => candidate.id === id);
        return item ? Effect.succeed(item) : Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: id }));
      },
      create: () => Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: "" }) as never),
      update: (id) => Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: id })),
      softDelete: (id) => Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: id })),
    }),
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: currentUser.id }, session: { id: currentSession.id } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true),
    }),
    makeUserRepoTest({
      findById: (id) => id === currentUser.id ? Effect.succeed(currentUser) : Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
      findByEmail: () => Effect.succeed(currentUser),
    }),
    makeSessionRepoTest({ findById: (id) => id === currentSession.id ? Effect.succeed(currentSession) : Effect.fail(new DBNotFoundError({ entity: "session", value: id })) }),
    makeServiceOfferedRepoTest({
      listByUserId: () => Effect.succeed(options.services ?? [service()]),
      findByIdForUser: (id, userId) =>
        existingService.id === id && existingService.userId === userId
          ? Effect.succeed(existingService)
          : Effect.fail(new DBNotFoundError({ entity: "serviceOffered", value: id })),
      create: (input) => {
        options.onCreate?.(input);
        return options.createError ? Effect.fail(options.createError) : Effect.succeed(service(input));
      },
      updateByIdForUser: (id, _userId, input) => {
        options.onUpdate?.(input);
        return Effect.succeed(service({ ...existingService, ...input, id }));
      },
      softDeleteByIdForUser: (id) => Effect.succeed(service({ id, deletedAt: new Date("2026-06-13T00:00:00.000Z") })),
    }),
    makeProviderSearchQueueTest({
      enqueueReconcile: () => Effect.succeed({ id: "job-1", name: "reconcile-provider" }),
      enqueueReindex: () => Effect.succeed({ id: "job-3", name: "reindex-all-providers" }),
    }),
    makeProviderSearchOutboxRepoTest({
      createPending: (userId) => Effect.succeed(outbox(userId)),
      listUnresolved: () => Effect.succeed([]),
      markProcessing: (id) => Effect.succeed(outbox(id)),
      markProcessed: (id) => Effect.succeed(outbox(id)),
      markFailed: (id) => Effect.succeed(outbox(id)),
      markSupersededBefore: () => Effect.succeed(0),
    }),
  );
};

describe("services offered route programs", () => {
  it("lists service offerings for the authenticated provider with the provider limit", async () => {
    const result = await Effect.runPromise(listServicesOfferedRouteProgram(new Headers()).pipe(Effect.provide(makeLayer())));
    expect(result.services).toEqual([expect.objectContaining({ id: "service-1", name: "Childcare", createdAt: "2026-06-12T00:00:00.000Z" })]);
    expect(result.maxServicesOffered).toBe(20);
  });

  it("reads the provider limit from SERVICES_OFFERED_MAX_PER_PROVIDER", async () => {
    const result = await Effect.runPromise(
      listServicesOfferedRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer()),
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map([["SERVICES_OFFERED_MAX_PER_PROVIDER", "5"]]))),
      ),
    );
    expect(result.maxServicesOffered).toBe(5);
  });

  it("creates a service offering with default currency", async () => {
    const created: Array<{ name: string; hourlyRateCents: number }> = [];
    const result = await Effect.runPromise(
      createServiceOfferedRouteProgram(contextWithJson({ name: "Tutoring", hourlyRateCents: 3000 }), new Headers()).pipe(
        Effect.provide(makeLayer({ onCreate: (input) => created.push(input) })),
      ),
    );

    expect(result).toMatchObject({ name: "Tutoring", hourlyRateCents: 3000, currency: "CAD" });
    expect(created).toEqual([expect.objectContaining({ name: "Tutoring", hourlyRateCents: 3000 })]);
  });

  it("rejects creating a service once the provider limit is reached", async () => {
    const atLimit = Array.from({ length: 20 }, (_, index) => service({ id: `service-${index + 1}` }));
    const exit = await Effect.runPromise(
      createServiceOfferedRouteProgram(contextWithJson({ name: "One too many", hourlyRateCents: 3000 }), new Headers()).pipe(
        Effect.provide(makeLayer({ services: atLimit })),
        Effect.exit,
      ),
    );
    const failure = getFailure(exit);
    expect(failure._tag).toBe("ServicesOfferedLimitReachedError");
    expect(failure).toMatchObject({ max: 20 });
  });

  it("enforces a lowered SERVICES_OFFERED_MAX_PER_PROVIDER on create", async () => {
    const exit = await Effect.runPromise(
      createServiceOfferedRouteProgram(contextWithJson({ name: "Second service", hourlyRateCents: 3000 }), new Headers()).pipe(
        Effect.provide(makeLayer({ services: [service()] })),
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map([["SERVICES_OFFERED_MAX_PER_PROVIDER", "1"]]))),
        Effect.exit,
      ),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "ServicesOfferedLimitReachedError", max: 1 });
  });

  it("rejects users without service-offered permission", async () => {
    const exit = await Effect.runPromise(listServicesOfferedRouteProgram(new Headers()).pipe(Effect.provide(makeLayer({ hasPermission: false })), Effect.exit));
    expect(getFailure(exit)._tag).toBe("ForbiddenError");
  });

  it("soft deletes a service offering", async () => {
    const result = await Effect.runPromise(deleteServiceOfferedRouteProgram(new Headers(), "service-1").pipe(Effect.provide(makeLayer())));
    expect(result).toMatchObject({ id: "service-1", deletedAt: "2026-06-13T00:00:00.000Z" });
  });
});

describe("services offered catalogue rules", () => {
  const liveItem = catalogueItem();
  const hiddenItem = catalogueItem({ id: "0197b3a0-0000-7000-8000-000000000002", name: "Homework tutoring", category: "Tutoring", baseHourlyRateCents: 2400, isLive: false });

  it("creates a service linked to a live catalogue item at or above the floor", async () => {
    const created: Array<{ name: string; hourlyRateCents: number; catalogueServiceId?: string | null }> = [];
    const result = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({ name: "Babysitting", hourlyRateCents: 1800, catalogueServiceId: liveItem.id }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer({ catalogueItems: [liveItem], onCreate: (input) => created.push(input) }))),
    );

    expect(result).toMatchObject({ hourlyRateCents: 1800, catalogueServiceId: liveItem.id });
    expect(created[0]?.catalogueServiceId).toBe(liveItem.id);
  });

  it("rejects creating a linked service below the floor", async () => {
    const exit = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({ name: "Babysitting", hourlyRateCents: 1700, catalogueServiceId: liveItem.id }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer({ catalogueItems: [liveItem] })), Effect.exit),
    );
    const failure = getFailure(exit);
    expect(failure._tag).toBe("ServiceRateBelowFloorError");
    expect(failure).toMatchObject({ floorCents: 1800 });
  });

  it("rejects creating a service linked to an unknown catalogue item", async () => {
    const exit = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({ name: "Babysitting", hourlyRateCents: 2000, catalogueServiceId: "0197b3a0-0000-7000-8000-00000000dead" }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer({ catalogueItems: [liveItem] })), Effect.exit),
    );
    expect(getFailure(exit)._tag).toBe("ServiceCatalogueItemNotFoundError");
  });

  it("rejects creating a service linked to a hidden catalogue item", async () => {
    const exit = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({ name: "Homework tutoring", hourlyRateCents: 2400, catalogueServiceId: hiddenItem.id }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer({ catalogueItems: [hiddenItem] })), Effect.exit),
    );
    expect(getFailure(exit)._tag).toBe("ServiceCatalogueItemHiddenError");
  });

  it("re-validates the floor when the rate of a linked service is updated", async () => {
    const existing = service({ catalogueServiceId: liveItem.id, hourlyRateCents: 2000 });
    const exit = await Effect.runPromise(
      updateServiceOfferedRouteProgram(contextWithJson({ hourlyRateCents: 1500 }), new Headers(), existing.id).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [liveItem] })),
        Effect.exit,
      ),
    );
    expect(getFailure(exit)._tag).toBe("ServiceRateBelowFloorError");
  });

  it("allows keeping an existing link to a now-hidden item when editing the rate", async () => {
    const existing = service({ catalogueServiceId: hiddenItem.id, hourlyRateCents: 2400 });
    const result = await Effect.runPromise(
      updateServiceOfferedRouteProgram(contextWithJson({ hourlyRateCents: 2600 }), new Headers(), existing.id).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [hiddenItem] })),
      ),
    );
    expect(result).toMatchObject({ hourlyRateCents: 2600, catalogueServiceId: hiddenItem.id });
  });

  it("rejects re-linking a service to a hidden catalogue item", async () => {
    const existing = service({ catalogueServiceId: null, hourlyRateCents: 2600 });
    const exit = await Effect.runPromise(
      updateServiceOfferedRouteProgram(contextWithJson({ catalogueServiceId: hiddenItem.id }), new Headers(), existing.id).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [hiddenItem] })),
        Effect.exit,
      ),
    );
    expect(getFailure(exit)._tag).toBe("ServiceCatalogueItemHiddenError");
  });

  it("unlinks a service from the catalogue with an explicit null", async () => {
    const updates: Array<{ catalogueServiceId?: string | null }> = [];
    const existing = service({ catalogueServiceId: liveItem.id });
    const result = await Effect.runPromise(
      updateServiceOfferedRouteProgram(contextWithJson({ catalogueServiceId: null }), new Headers(), existing.id).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [liveItem], onUpdate: (input) => updates.push(input) })),
      ),
    );
    expect(updates[0]?.catalogueServiceId).toBeNull();
    expect(result).toMatchObject({ catalogueServiceId: null });
  });

  it("allows unlinking and lowering the rate below the old floor in one call", async () => {
    // Regression: loose equality (== undefined) once conflated explicit null
    // with "absent", so the removed link's floor was wrongly enforced here.
    const existing = service({ catalogueServiceId: liveItem.id, hourlyRateCents: 1800 });
    const result = await Effect.runPromise(
      updateServiceOfferedRouteProgram(contextWithJson({ catalogueServiceId: null, hourlyRateCents: 100 }), new Headers(), existing.id).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [liveItem] })),
      ),
    );
    expect(result).toMatchObject({ catalogueServiceId: null, hourlyRateCents: 100 });
  });

  it("clears the description with an explicit null", async () => {
    const updates: Array<{ description?: string | null }> = [];
    const existing = service({ description: "Old blurb" });
    await Effect.runPromise(
      updateServiceOfferedRouteProgram(contextWithJson({ description: null }), new Headers(), existing.id).pipe(
        Effect.provide(makeLayer({ existingService: existing, onUpdate: (input) => updates.push(input) })),
      ),
    );
    expect(updates[0]).toMatchObject({ description: null });
  });

  it("treats a link to a soft-deleted item like a hidden one when editing the rate", async () => {
    const deletedItem = catalogueItem({
      id: "0197b3a0-0000-7000-8000-000000000003",
      deletedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const existing = service({ catalogueServiceId: deletedItem.id, hourlyRateCents: 1800 });

    const raised = await Effect.runPromise(
      updateServiceOfferedRouteProgram(contextWithJson({ hourlyRateCents: 2000 }), new Headers(), existing.id).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [deletedItem] })),
      ),
    );
    expect(raised).toMatchObject({ hourlyRateCents: 2000, catalogueServiceId: deletedItem.id });

    const lowered = await Effect.runPromise(
      updateServiceOfferedRouteProgram(contextWithJson({ hourlyRateCents: 100 }), new Headers(), existing.id).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [deletedItem] })),
        Effect.exit,
      ),
    );
    expect(getFailure(lowered)._tag).toBe("ServiceRateBelowFloorError");
  });

  it("rejects linking to a soft-deleted catalogue item", async () => {
    const deletedItem = catalogueItem({
      id: "0197b3a0-0000-7000-8000-000000000003",
      deletedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const existing = service({ catalogueServiceId: null, hourlyRateCents: 2500 });
    const exit = await Effect.runPromise(
      updateServiceOfferedRouteProgram(contextWithJson({ catalogueServiceId: deletedItem.id }), new Headers(), existing.id).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [deletedItem] })),
        Effect.exit,
      ),
    );
    expect(getFailure(exit)._tag).toBe("ServiceCatalogueItemNotFoundError");
  });
});
