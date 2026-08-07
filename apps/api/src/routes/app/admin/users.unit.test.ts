import {
  type DirectoryUser,
  makeSessionRepoTest,
  makeUserDirectoryRepoTest,
  makeUserRepoTest,
  type Session,
  type User
} from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { listAdminUsersRouteProgram } from './users.handler';

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

const directoryUser = (overrides: Partial<DirectoryUser> = {}): DirectoryUser => ({
  id: 'user-1',
  email: 'maria@email.com',
  name: 'maria@email.com',
  role: 'service-provider',
  banned: false,
  banReason: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  firstName: 'Maria',
  lastName: 'Santos',
  ...overrides
});

const makeLayer = (options: { hasPermission?: boolean; users?: Array<DirectoryUser> } = {}) =>
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
    makeUserDirectoryRepoTest({ listAll: () => Effect.succeed(options.users ?? []) })
  );

describe('GET /admin/users', () => {
  it('returns the directory with profile names preferred over the auth name', async () => {
    const result = await Effect.runPromise(
      listAdminUsersRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            users: [
              directoryUser(),
              directoryUser({
                id: 'user-2',
                email: 'jordan@email.com',
                name: 'Jordan',
                firstName: null,
                lastName: null,
                role: 'family'
              }),
              directoryUser({
                id: 'user-3',
                email: 'banned@email.com',
                banned: true,
                banReason: 'spam'
              })
            ]
          })
        )
      )
    );

    expect(result.users).toHaveLength(3);
    expect(result.users[0]).toMatchObject({
      name: 'Maria Santos',
      role: 'service-provider',
      banned: false
    });
    expect(result.users[1]).toMatchObject({ name: 'Jordan', role: 'family' });
    expect(result.users[2]).toMatchObject({ banned: true, banReason: 'spam' });
  });

  it('fails with ForbiddenError without the user list permission', async () => {
    const exit = await Effect.runPromiseExit(
      listAdminUsersRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false }))
      )
    );

    if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
    const failure = Cause.failureOption(exit.cause);
    if (Option.isNone(failure)) throw new Error('Expected typed failure');
    expect(failure.value).toMatchObject({ _tag: 'ForbiddenError' });
  });
});
