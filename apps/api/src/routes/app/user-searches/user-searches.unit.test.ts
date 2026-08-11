import {
  DBNotFoundError,
  makeSessionRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  makeUserSearchRepoTest,
  type SafeUserProfile,
  type Session,
  type User,
  type UserSearch,
  type UserSearchCreateInput
} from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { createUserSearchRouteProgram } from './user-searches.handler';
import type { HonoContext, HonoEnv } from '@/api/app-env';

const family = (): User => ({
  id: 'family-1',
  name: 'Maria Santos',
  email: 'maria@email.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  isAnonymous: false,
  role: 'family',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null
});

const session = (): Session => ({
  id: 'session-1',
  expiresAt: new Date('2026-06-13T00:00:00.000Z'),
  token: 'token',
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ipAddress: null,
  userAgent: null,
  userId: 'family-1',
  impersonatedBy: null,
  activeOrganizationId: null
});

const savedSearch = (input: UserSearchCreateInput): UserSearch => ({
  id: 'search-1',
  userId: input.userId,
  details: input.details,
  createdAt: new Date('2026-08-11T00:00:00.000Z')
});

const familyProfile = (overrides: Partial<SafeUserProfile> = {}): SafeUserProfile => ({
  userId: 'family-1',
  language: 'en',
  firstName: 'Maria',
  lastName: 'Santos',
  gender: null,
  phoneNumber: null,
  dateOfBirth: null,
  address: null,
  city: 'Mission',
  postalCode: null,
  country: 'Canada',
  stateProvince: 'BC',
  shortBio: null,
  googlePlaceId: 'place-1',
  latitude: 49.1327,
  longitude: -122.3095,
  email: 'maria@email.com',
  role: 'family',
  image: null,
  ...overrides
});

const fakeContext = (body: unknown) =>
  ({ req: { json: () => Promise.resolve(body) } }) as unknown as HonoContext<HonoEnv>;

const makeLayer = (
  options: {
    hasPermission?: boolean;
    created?: Array<UserSearchCreateInput>;
    profile?: SafeUserProfile | null;
  } = {}
) =>
  Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: 'family-1' }, session: { id: 'session-1' } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeUserRepoTest({
      findById: () => Effect.succeed(family()),
      findByEmail: () => Effect.die('not used')
    }),
    makeSessionRepoTest({ findById: () => Effect.succeed(session()) }),
    makeUserProfileRepoTest({
      create: () => Effect.die('not used'),
      findByUserId: () =>
        options.profile === null
          ? Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: 'family-1' }))
          : Effect.succeed(options.profile ?? familyProfile()),
      updateByUserId: () => Effect.die('not used'),
      updateLocationByUserId: () => Effect.die('not used')
    }),
    makeUserSearchRepoTest({
      create: (input) => {
        options.created?.push(input);
        return Effect.succeed(savedSearch(input));
      },
      listPaginated: () => Effect.die('not used')
    })
  );

describe('POST /user-searches', () => {
  it('saves the caller-supplied filter set against the session user', async () => {
    const created: Array<UserSearchCreateInput> = [];
    const result = await Effect.runPromise(
      createUserSearchRouteProgram(
        fakeContext({
          q: 'newborn',
          service: 'A-la-carte Services',
          radiusKm: 50,
          minHourlyRateCents: 2000,
          maxHourlyRateCents: 4500,
          sort: 'distance'
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ created })))
    );

    expect(result).toMatchObject({ id: 'search-1', createdAt: '2026-08-11T00:00:00.000Z' });
    expect(created).toHaveLength(1);
    expect(created[0].userId).toBe('family-1');
    expect(created[0].details).toMatchObject({
      q: 'newborn',
      service: 'A-la-carte Services',
      radiusKm: 50,
      minHourlyRateCents: 2000,
      maxHourlyRateCents: 4500,
      sort: 'distance'
    });
  });

  it("snapshots the caller's profile location server-side", async () => {
    const created: Array<UserSearchCreateInput> = [];
    await Effect.runPromise(
      // A client-sent location must be ignored, not stored.
      createUserSearchRouteProgram(
        fakeContext({ q: 'newborn', location: { city: 'Spoofed' } }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ created })))
    );

    expect(created[0].details.location).toEqual({
      city: 'Mission',
      stateProvince: 'BC',
      country: 'Canada',
      latitude: 49.1327,
      longitude: -122.3095
    });
  });

  it('accepts an empty filter set and records no location without a profile', async () => {
    const created: Array<UserSearchCreateInput> = [];
    await Effect.runPromise(
      createUserSearchRouteProgram(fakeContext({}), new Headers()).pipe(
        Effect.provide(makeLayer({ created, profile: null }))
      )
    );

    expect(created[0].details).toEqual({});
  });

  it('rejects an unsupported sort value', async () => {
    const exit = await Effect.runPromiseExit(
      createUserSearchRouteProgram(fakeContext({ sort: 'cheapest' }), new Headers()).pipe(
        Effect.provide(makeLayer())
      )
    );

    if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
    const failure = Cause.failureOption(exit.cause);
    if (Option.isNone(failure)) throw new Error('Expected typed failure');
    expect(failure.value).toMatchObject({ _tag: 'RequestValidationError' });
  });

  it('fails with ForbiddenError without the userSearch write permission', async () => {
    const exit = await Effect.runPromiseExit(
      createUserSearchRouteProgram(fakeContext({}), new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false }))
      )
    );

    if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
    const failure = Cause.failureOption(exit.cause);
    if (Option.isNone(failure)) throw new Error('Expected typed failure');
    expect(failure.value).toMatchObject({ _tag: 'ForbiddenError' });
  });
});
