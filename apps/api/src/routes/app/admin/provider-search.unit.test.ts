import { makeProviderSearchQueueTest } from '@repo/queue';
import {
  DBNotFoundError,
  makeSessionRepoTest,
  makeUserRepoTest,
  type Session,
  type User
} from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { scheduleProviderSearchReindexRouteProgram } from './provider-search.handler';

const admin = (): User => ({
  id: 'admin-1',
  name: 'Admin',
  email: 'admin@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
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

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

const makeLayer = (options: { hasPermission?: boolean; onReindex?: () => void } = {}) => {
  const currentUser = admin();
  const currentSession = session();

  return Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () =>
        Effect.succeed({ user: { id: currentUser.id }, session: { id: currentSession.id } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeUserRepoTest({
      findById: (id) =>
        id === currentUser.id
          ? Effect.succeed(currentUser)
          : Effect.fail(new DBNotFoundError({ entity: 'user', value: id })),
      findByEmail: () => Effect.succeed(currentUser)
    }),
    makeSessionRepoTest({
      findById: (id) =>
        id === currentSession.id
          ? Effect.succeed(currentSession)
          : Effect.fail(new DBNotFoundError({ entity: 'session', value: id }))
    }),
    makeProviderSearchQueueTest({
      enqueueReconcile: () => Effect.succeed({ id: 'job-1', name: 'reconcile-provider' }),
      enqueueReindex: () => {
        options.onReindex?.();
        return Effect.succeed({ id: 'job-3', name: 'reindex-all-providers' });
      }
    })
  );
};

describe('admin provider search route program', () => {
  it('schedules a provider search reindex job', async () => {
    const onReindex = vi.fn();
    const result = await Effect.runPromise(
      scheduleProviderSearchReindexRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ onReindex }))
      )
    );

    expect(result).toEqual({ jobId: 'job-3', status: 'scheduled' });
    expect(onReindex).toHaveBeenCalledOnce();
  });

  it('requires reindex permission', async () => {
    const exit = await Effect.runPromise(
      scheduleProviderSearchReindexRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false })),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('ForbiddenError');
  });
});
