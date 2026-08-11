import {
  makeSessionRepoTest,
  makeUserRepoTest,
  makeUserSearchRepoTest,
  type Session,
  type User,
  type UserSearchWithUser
} from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { listUserSearchesRouteProgram } from './user-searches.handler';

const admin = (): User => ({
  id: 'admin-1',
  name: 'Alex Chen',
  email: 'alex@poppynz.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  isAnonymous: false,
  role: 'admin',
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
  userId: 'admin-1',
  impersonatedBy: null,
  activeOrganizationId: null
});

const search = (overrides: Partial<UserSearchWithUser> = {}): UserSearchWithUser => ({
  id: 'search-1',
  userId: 'family-1',
  details: { q: 'newborn', radiusKm: 50 },
  createdAt: new Date('2026-08-11T09:30:00.000Z'),
  userName: 'Maria Santos',
  userEmail: 'maria@email.com',
  ...overrides
});

const makeLayer = (
  options: {
    hasPermission?: boolean;
    searches?: Array<UserSearchWithUser>;
    total?: number;
    calls?: Array<{ page: number; perPage: number }>;
  } = {}
) =>
  Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: 'admin-1' }, session: { id: 'session-1' } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeUserRepoTest({
      findById: () => Effect.succeed(admin()),
      findByEmail: () => Effect.die('not used')
    }),
    makeSessionRepoTest({ findById: () => Effect.succeed(session()) }),
    makeUserSearchRepoTest({
      create: () => Effect.die('not used'),
      listPaginated: (page, perPage) => {
        options.calls?.push({ page, perPage });
        return Effect.succeed({
          searches: options.searches ?? [],
          total: options.total ?? options.searches?.length ?? 0
        });
      }
    })
  );

describe('GET /admin/user-searches', () => {
  it('returns the joined page with ISO timestamps and echoes pagination', async () => {
    const result = await Effect.runPromise(
      listUserSearchesRouteProgram(new Headers(), { page: '2', perPage: '10' }).pipe(
        Effect.provide(makeLayer({ searches: [search()], total: 11 }))
      )
    );

    expect(result.pagination).toEqual({ page: 2, perPage: 10, total: 11 });
    expect(result.searches[0]).toMatchObject({
      id: 'search-1',
      userName: 'Maria Santos',
      userEmail: 'maria@email.com',
      details: { q: 'newborn', radiusKm: 50 },
      createdAt: '2026-08-11T09:30:00.000Z'
    });
  });

  it('clamps malformed and oversized pagination params', async () => {
    const calls: Array<{ page: number; perPage: number }> = [];
    await Effect.runPromise(
      listUserSearchesRouteProgram(new Headers(), { page: 'abc', perPage: '999' }).pipe(
        Effect.provide(makeLayer({ calls }))
      )
    );

    expect(calls).toEqual([{ page: 1, perPage: 50 }]);
  });

  it('fails with ForbiddenError without the userSearch read permission', async () => {
    const exit = await Effect.runPromiseExit(
      listUserSearchesRouteProgram(new Headers(), {}).pipe(
        Effect.provide(makeLayer({ hasPermission: false }))
      )
    );

    if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
    const failure = Cause.failureOption(exit.cause);
    if (Option.isNone(failure)) throw new Error('Expected typed failure');
    expect(failure.value).toMatchObject({ _tag: 'ForbiddenError' });
  });
});
