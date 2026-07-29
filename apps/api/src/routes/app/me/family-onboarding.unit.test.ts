import {
  DBNotFoundError,
  makeServiceNeededRepoTest,
  makeUserProfileRepoTest,
  type SafeUserProfile,
  type ServiceNeeded,
} from "@repo/db";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { UserAndSession } from "@/api/lib/effect-auth";
import { getFamilyOnboardingProgram } from "./onboarding.handler";

const userAndSession = (role: UserAndSession["user"]["role"] = "family"): UserAndSession => ({
  user: {
    id: "user-1",
    name: "Family User",
    email: "family@example.com",
    emailVerified: true,
    image: null,
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    updatedAt: new Date("2026-06-12T00:00:00.000Z"),
    isAnonymous: false,
    role,
    banned: false,
    banReason: null,
    banExpires: null,
    phoneNumber: null,
    phoneNumberVerified: null,
  },
  session: {
    id: "session-1",
    expiresAt: new Date("2026-06-13T00:00:00.000Z"),
    token: "token",
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    updatedAt: new Date("2026-06-12T00:00:00.000Z"),
    ipAddress: null,
    userAgent: null,
    userId: "user-1",
    impersonatedBy: null,
    activeOrganizationId: null,
  },
});

const profile = (overrides: Partial<SafeUserProfile> = {}): SafeUserProfile => ({
  userId: "user-1",
  email: "family@example.com",
  role: "family",
  language: "en",
  firstName: "Fiona",
  lastName: "Family",
  gender: null,
  phoneNumber: null,
  dateOfBirth: null,
  address: "123 Main Street",
  city: "Toronto",
  postalCode: "M5H 1A1",
  country: "CA",
  stateProvince: "ON",
  shortBio: null,
  googlePlaceId: "place-1",
  latitude: 43.6532,
  longitude: -79.3832,
  ...overrides,
});

const need = (overrides: Partial<ServiceNeeded> = {}): ServiceNeeded => ({
  id: "need-1",
  userId: "user-1",
  catalogueServiceId: null,
  name: "After-school care",
  description: null,
  deletedAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected effect to fail");
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error("Expected typed failure");
  return failure.value;
};

const makeLayer = (options: { profile?: SafeUserProfile; needs?: Array<ServiceNeeded> } = {}) =>
  Layer.mergeAll(
    makeUserProfileRepoTest({
      create: (input) => Effect.succeed({ userId: input.userId, language: input.language } as never),
      findByUserId: () => Effect.succeed(options.profile ?? profile()),
      updateByUserId: (id) => Effect.fail(new DBNotFoundError({ entity: "userProfile", value: id })),
      updateLocationByUserId: (id) => Effect.fail(new DBNotFoundError({ entity: "userProfile", value: id })),
    }),
    makeServiceNeededRepoTest({
      listByUserId: () => Effect.succeed(options.needs ?? [need()]),
      findByIdForUser: (id) => Effect.fail(new DBNotFoundError({ entity: "serviceNeeded", value: id })),
      create: () => Effect.fail(new DBNotFoundError({ entity: "serviceNeeded", value: "" }) as never),
      updateByIdForUser: (id) => Effect.fail(new DBNotFoundError({ entity: "serviceNeeded", value: id })),
      softDeleteByIdForUser: (id) => Effect.fail(new DBNotFoundError({ entity: "serviceNeeded", value: id })),
    }),
  );

describe("family onboarding program", () => {
  it("reports both steps complete for a family with a location and needs", async () => {
    const result = await Effect.runPromise(
      getFamilyOnboardingProgram(userAndSession()).pipe(Effect.provide(makeLayer())),
    );

    expect(result).toMatchObject({
      userId: "user-1",
      firstName: "Fiona",
      progress: { completed: 2, total: 2 },
      steps: {
        location: { complete: true },
        needs: { complete: true, count: 1 },
      },
    });
  });

  it("reports the location step incomplete without saved coordinates", async () => {
    const result = await Effect.runPromise(
      getFamilyOnboardingProgram(userAndSession()).pipe(
        Effect.provide(makeLayer({ profile: profile({ latitude: null, longitude: null }) })),
      ),
    );

    expect(result.progress).toEqual({ completed: 1, total: 2 });
    expect(result.steps.location.complete).toBe(false);
  });

  it("reports the needs step incomplete when the family has no active needs", async () => {
    const result = await Effect.runPromise(
      getFamilyOnboardingProgram(userAndSession()).pipe(Effect.provide(makeLayer({ needs: [] }))),
    );

    expect(result.progress).toEqual({ completed: 1, total: 2 });
    expect(result.steps.needs).toEqual({ complete: false, count: 0 });
  });

  it("rejects non-family roles", async () => {
    const exit = await Effect.runPromise(
      getFamilyOnboardingProgram(userAndSession("service-provider")).pipe(
        Effect.provide(makeLayer()),
        Effect.exit,
      ),
    );

    expect(getFailure(exit)._tag).toBe("OnboardingRoleError");
  });
});
