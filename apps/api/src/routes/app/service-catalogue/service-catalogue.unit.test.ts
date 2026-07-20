import { SqlError } from "@effect/sql/SqlError";
import {
  DBNotFoundError,
  makeServiceCatalogueRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type ServiceCatalogueItem,
  type Session,
  type User,
} from "@repo/db";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { makeAuthServiceTest } from "@/api/lib/effect-auth";
import {
  createServiceCatalogueItemRouteProgram,
  deleteServiceCatalogueItemRouteProgram,
  listAdminServiceCatalogueRouteProgram,
  listLiveServiceCatalogueRouteProgram,
  updateServiceCatalogueItemRouteProgram,
} from "./service-catalogue.handler";

const user = (overrides: Partial<User> = {}): User => ({
  id: "admin-1", name: "Admin", email: "admin@example.com", emailVerified: true, image: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"), updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  isAnonymous: false, role: "admin", banned: false, banReason: null, banExpires: null, phoneNumber: null, phoneNumberVerified: null,
  ...overrides,
});

const session = (): Session => ({
  id: "session-1", expiresAt: new Date("2026-07-02T00:00:00.000Z"), token: "token",
  createdAt: new Date("2026-07-01T00:00:00.000Z"), updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  ipAddress: null, userAgent: null, userId: "admin-1", impersonatedBy: null, activeOrganizationId: null,
});

const item = (overrides: Partial<ServiceCatalogueItem> = {}): ServiceCatalogueItem => ({
  id: "item-1", name: "Babysitting", category: "Childcare", baseHourlyRateCents: 1800, currency: "CAD", isLive: true,
  createdAt: new Date("2026-07-01T00:00:00.000Z"), updatedAt: new Date("2026-07-01T00:00:00.000Z"), deletedAt: null,
  ...overrides,
});

const contextWithJson = (body: unknown) => ({ req: { json: async () => body } }) as HonoContext<HonoEnv>;

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected effect to fail");
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error("Expected typed failure");
  return failure.value;
};

const makeLayer = (options: {
  items?: Array<ServiceCatalogueItem>;
  hasPermission?: boolean;
  createError?: SqlError;
  onCreate?: (input: { name: string; category: string; baseHourlyRateCents: number; currency?: string | null; isLive?: boolean | null }) => void;
  onUpdate?: (id: string, input: Record<string, unknown>) => void;
} = {}) => {
  const currentUser = user();
  const currentSession = session();
  const items = options.items ?? [item()];
  return Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: currentUser.id }, session: { id: currentSession.id } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true),
    }),
    makeUserRepoTest({
      findById: (id) => id === currentUser.id ? Effect.succeed(currentUser) : Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
      findByEmail: () => Effect.succeed(currentUser),
    }),
    makeSessionRepoTest({ findById: (id) => id === currentSession.id ? Effect.succeed(currentSession) : Effect.fail(new DBNotFoundError({ entity: "session", value: id })) }),
    makeServiceCatalogueRepoTest({
      listActive: () => Effect.succeed(items),
      listLive: () => Effect.succeed(items.filter((candidate) => candidate.isLive)),
      findActiveById: (id) => {
        const found = items.find((candidate) => candidate.id === id && candidate.deletedAt === null);
        return found ? Effect.succeed(found) : Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: id }));
      },
      findById: (id) => {
        const found = items.find((candidate) => candidate.id === id);
        return found ? Effect.succeed(found) : Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: id }));
      },
      create: (input) => {
        options.onCreate?.(input);
        return options.createError
          ? Effect.fail(options.createError)
          : Effect.succeed(item({ ...input, id: "item-new", currency: input.currency ?? "CAD", isLive: input.isLive ?? true }));
      },
      update: (id, input) => {
        const found = items.find((candidate) => candidate.id === id);
        if (!found) return Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: id }));
        options.onUpdate?.(id, input);
        return Effect.succeed(item({ ...found, ...input }));
      },
      softDelete: (id) => {
        const found = items.find((candidate) => candidate.id === id);
        if (!found) return Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: id }));
        return Effect.succeed(item({ ...found, deletedAt: new Date("2026-07-02T00:00:00.000Z") }));
      },
    }),
  );
};

describe("service catalogue route programs", () => {
  it("lists only live items for the provider-facing endpoint", async () => {
    const items = [item(), item({ id: "item-2", name: "Homework tutoring", category: "Tutoring", isLive: false })];
    const result = await Effect.runPromise(listLiveServiceCatalogueRouteProgram(new Headers()).pipe(Effect.provide(makeLayer({ items }))));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "item-1", isLive: true, createdAt: "2026-07-01T00:00:00.000Z" });
  });

  it("lists hidden items too on the admin endpoint", async () => {
    const items = [item(), item({ id: "item-2", isLive: false })];
    const result = await Effect.runPromise(listAdminServiceCatalogueRouteProgram(new Headers()).pipe(Effect.provide(makeLayer({ items }))));
    expect(result).toHaveLength(2);
  });

  it("creates an item with defaults applied", async () => {
    const created: Array<{ name: string; category: string; baseHourlyRateCents: number }> = [];
    const result = await Effect.runPromise(
      createServiceCatalogueItemRouteProgram(
        contextWithJson({ name: "Weekend babysitting", category: "Childcare", baseHourlyRateCents: 1900 }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer({ onCreate: (input) => created.push(input) }))),
    );
    expect(result).toMatchObject({ name: "Weekend babysitting", currency: "CAD", isLive: true });
    expect(created).toHaveLength(1);
  });

  it("rejects invalid create input", async () => {
    const exit = await Effect.runPromise(
      createServiceCatalogueItemRouteProgram(
        contextWithJson({ name: "", category: "Childcare", baseHourlyRateCents: -5 }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer()), Effect.exit),
    );
    expect(getFailure(exit)._tag).toBe("RequestValidationError");
  });

  it("rejects users without the serviceCatalogue permission", async () => {
    const exit = await Effect.runPromise(
      listAdminServiceCatalogueRouteProgram(new Headers()).pipe(Effect.provide(makeLayer({ hasPermission: false })), Effect.exit),
    );
    expect(getFailure(exit)._tag).toBe("ForbiddenError");
  });

  it("updates an item", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const result = await Effect.runPromise(
      updateServiceCatalogueItemRouteProgram(contextWithJson({ isLive: false }), new Headers(), "item-1").pipe(
        Effect.provide(makeLayer({ onUpdate: (_id, input) => updates.push(input) })),
      ),
    );
    expect(result).toMatchObject({ id: "item-1", isLive: false });
    expect(updates).toEqual([{ isLive: false }]);
  });

  it("maps a missing item to ServiceCatalogueNotFoundError on update", async () => {
    const exit = await Effect.runPromise(
      updateServiceCatalogueItemRouteProgram(contextWithJson({ isLive: false }), new Headers(), "missing").pipe(
        Effect.provide(makeLayer()),
        Effect.exit,
      ),
    );
    expect(getFailure(exit)._tag).toBe("ServiceCatalogueNotFoundError");
  });

  it("soft deletes an item", async () => {
    const result = await Effect.runPromise(
      deleteServiceCatalogueItemRouteProgram(new Headers(), "item-1").pipe(Effect.provide(makeLayer())),
    );
    expect(result).toMatchObject({ id: "item-1", deletedAt: "2026-07-02T00:00:00.000Z" });
  });

  it("maps SqlError to ServiceCatalogueRepoError on create", async () => {
    const exit = await Effect.runPromise(
      createServiceCatalogueItemRouteProgram(
        contextWithJson({ name: "Weekend babysitting", category: "Childcare", baseHourlyRateCents: 1900 }),
        new Headers(),
      ).pipe(
        Effect.provide(makeLayer({ createError: new SqlError({ cause: new Error("boom"), message: "boom" }) })),
        Effect.exit,
      ),
    );
    expect(getFailure(exit)._tag).toBe("ServiceCatalogueRepoError");
  });
});
