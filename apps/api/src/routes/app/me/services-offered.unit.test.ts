import { SqlError } from "@effect/sql/SqlError";
import { DBNotFoundError, makeServiceOfferedRepoTest, makeSessionRepoTest, makeUserRepoTest, type ServiceOffered, type Session, type User } from "@repo/db";
import { makeProviderSearchQueueTest } from "@repo/queue";
import { makeProviderSearchOutboxRepoTest, type ProviderSearchOutbox } from "@repo/db";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { makeAuthServiceTest } from "@/api/lib/effect-auth";
import { createServiceOfferedRouteProgram, deleteServiceOfferedRouteProgram, listServicesOfferedRouteProgram } from "./services-offered.handler";

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
  id: "service-1", userId: "provider-1", name: "Childcare", description: null, hourlyRateCents: 2500, currency: "CAD",
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

const makeLayer = (options: { user?: User; services?: Array<ServiceOffered>; hasPermission?: boolean; createError?: SqlError; onCreate?: (input: { name: string; hourlyRateCents: number }) => void } = {}) => {
  const currentUser = options.user ?? user();
  const currentSession = session();
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
    makeServiceOfferedRepoTest({
      listByUserId: () => Effect.succeed(options.services ?? [service()]),
      create: (input) => {
        options.onCreate?.(input);
        return options.createError ? Effect.fail(options.createError) : Effect.succeed(service(input));
      },
      updateByIdForUser: (id) => Effect.succeed(service({ id })),
      softDeleteByIdForUser: (id) => Effect.succeed(service({ id, deletedAt: new Date("2026-06-13T00:00:00.000Z") })),
    }),
    makeProviderSearchQueueTest({
      enqueueReconcile: () => Effect.succeed({ id: "job-1", name: "reconcile-provider" }),
      enqueueExpiryReconcile: () => Effect.succeed({ id: "job-2", name: "reconcile-provider" }),
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
  it("lists service offerings for the authenticated provider", async () => {
    const result = await Effect.runPromise(listServicesOfferedRouteProgram(new Headers()).pipe(Effect.provide(makeLayer())));
    expect(result).toEqual([expect.objectContaining({ id: "service-1", name: "Childcare", createdAt: "2026-06-12T00:00:00.000Z" })]);
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

  it("rejects users without service-offered permission", async () => {
    const exit = await Effect.runPromise(listServicesOfferedRouteProgram(new Headers()).pipe(Effect.provide(makeLayer({ hasPermission: false })), Effect.exit));
    expect(getFailure(exit)._tag).toBe("ForbiddenError");
  });

  it("soft deletes a service offering", async () => {
    const result = await Effect.runPromise(deleteServiceOfferedRouteProgram(new Headers(), "service-1").pipe(Effect.provide(makeLayer())));
    expect(result).toMatchObject({ id: "service-1", deletedAt: "2026-06-13T00:00:00.000Z" });
  });
});
