import {
  DBNotFoundError,
  makeFamilySearchOutboxRepoTest,
  makeServiceCatalogueRepoTest,
  makeServiceNeededRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type FamilySearchOutbox,
  type ServiceCatalogueItem,
  type ServiceNeeded,
  type Session,
  type User
} from '@repo/db';
import { makeFamilySearchQueueTest } from '@repo/queue';
import { Cause, ConfigProvider, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  createServiceNeededRouteProgram,
  deleteServiceNeededRouteProgram,
  listServicesNeededRouteProgram,
  updateServiceNeededRouteProgram
} from './services-needed.handler';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'family-1',
  name: 'Family',
  email: 'family@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  isAnonymous: false,
  role: 'family',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null,
  ...overrides
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

const service = (overrides: Partial<ServiceNeeded> = {}): ServiceNeeded => ({
  id: 'need-1',
  userId: 'family-1',
  catalogueServiceId: null,
  name: 'Childcare',
  description: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  deletedAt: null,
  ...overrides
});

const catalogueItem = (overrides: Partial<ServiceCatalogueItem> = {}): ServiceCatalogueItem => ({
  id: '0197b3a0-0000-7000-8000-000000000001',
  name: 'Babysitting',
  category: 'Childcare',
  baseHourlyRateCents: 1800,
  currency: 'CAD',
  isLive: true,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  deletedAt: null,
  ...overrides
});

const contextWithJson = (body: unknown) =>
  ({ req: { json: async () => body } }) as HonoContext<HonoEnv>;

const outbox = (userId = 'family-1'): FamilySearchOutbox => ({
  id: 'outbox-1',
  userId,
  status: 'pending',
  attempts: 0,
  lastError: null,
  processedAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z')
});

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

const makeLayer = (
  options: {
    user?: User;
    services?: Array<ServiceNeeded>;
    existingService?: ServiceNeeded;
    catalogueItems?: Array<ServiceCatalogueItem>;
    hasPermission?: boolean;
    reconciledUserIds?: Array<string>;
    onCreate?: (input: { name: string; catalogueServiceId?: string | null }) => void;
    onUpdate?: (input: {
      name?: string;
      description?: string | null;
      catalogueServiceId?: string | null;
    }) => void;
  } = {}
) => {
  const currentUser = options.user ?? user();
  const currentSession = session();
  const existingService = options.existingService ?? service();
  const catalogueItems = options.catalogueItems ?? [];
  return Layer.mergeAll(
    makeServiceCatalogueRepoTest({
      listActive: () => Effect.succeed(catalogueItems),
      listLive: () => Effect.succeed(catalogueItems.filter((item) => item.isLive)),
      findActiveById: (id) => {
        const item = catalogueItems.find(
          (candidate) => candidate.id === id && candidate.deletedAt === null
        );
        return item
          ? Effect.succeed(item)
          : Effect.fail(new DBNotFoundError({ entity: 'serviceCatalogueItem', value: id }));
      },
      findById: (id) => {
        const item = catalogueItems.find((candidate) => candidate.id === id);
        return item
          ? Effect.succeed(item)
          : Effect.fail(new DBNotFoundError({ entity: 'serviceCatalogueItem', value: id }));
      },
      create: () =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceCatalogueItem', value: '' }) as never),
      update: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceCatalogueItem', value: id })),
      softDelete: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceCatalogueItem', value: id }))
    }),
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
    makeServiceNeededRepoTest({
      listByUserId: () => Effect.succeed(options.services ?? [service()]),
      findByIdForUser: (id, userId) =>
        existingService.id === id && existingService.userId === userId
          ? Effect.succeed(existingService)
          : Effect.fail(new DBNotFoundError({ entity: 'serviceNeeded', value: id })),
      create: (input) => {
        options.onCreate?.(input);
        return Effect.succeed(service(input));
      },
      updateByIdForUser: (id, _userId, input) => {
        options.onUpdate?.(input);
        return Effect.succeed(service({ ...existingService, ...input, id }));
      },
      softDeleteByIdForUser: (id) =>
        Effect.succeed(service({ id, deletedAt: new Date('2026-06-13T00:00:00.000Z') }))
    }),
    makeFamilySearchQueueTest({
      enqueueReconcile: (input) => {
        options.reconciledUserIds?.push(input.userId);
        return Effect.succeed({ id: 'job-1', name: 'reconcile-family' });
      },
      enqueueReindex: () => Effect.succeed({ id: 'job-3', name: 'reindex-all-families' })
    }),
    makeFamilySearchOutboxRepoTest({
      createPending: (userId) => Effect.succeed(outbox(userId)),
      listUnresolved: () => Effect.succeed([]),
      markProcessing: (id) => Effect.succeed(outbox(id)),
      markProcessed: (id) => Effect.succeed(outbox(id)),
      markFailed: (id) => Effect.succeed(outbox(id)),
      markSupersededBefore: () => Effect.succeed(0)
    })
  );
};

describe('services needed route programs', () => {
  it('lists needed services for the authenticated family with the family limit', async () => {
    const result = await Effect.runPromise(
      listServicesNeededRouteProgram(new Headers()).pipe(Effect.provide(makeLayer()))
    );
    expect(result.services).toEqual([
      expect.objectContaining({
        id: 'need-1',
        name: 'Childcare',
        createdAt: '2026-06-12T00:00:00.000Z'
      })
    ]);
    expect(result.maxServicesNeeded).toBe(20);
  });

  it('reads the family limit from SERVICES_NEEDED_MAX_PER_FAMILY', async () => {
    const result = await Effect.runPromise(
      listServicesNeededRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer()),
        Effect.withConfigProvider(
          ConfigProvider.fromMap(new Map([['SERVICES_NEEDED_MAX_PER_FAMILY', '5']]))
        )
      )
    );
    expect(result.maxServicesNeeded).toBe(5);
  });

  it('creates a needed service and schedules a family search reconcile', async () => {
    const created: Array<{ name: string }> = [];
    const reconciledUserIds: Array<string> = [];
    const result = await Effect.runPromise(
      createServiceNeededRouteProgram(contextWithJson({ name: 'Tutoring' }), new Headers()).pipe(
        Effect.provide(makeLayer({ onCreate: (input) => created.push(input), reconciledUserIds }))
      )
    );

    expect(result).toMatchObject({ name: 'Tutoring' });
    expect(created).toEqual([expect.objectContaining({ name: 'Tutoring' })]);
    expect(reconciledUserIds).toEqual(['family-1']);
  });

  it('rejects creating a need once the family limit is reached', async () => {
    const atLimit = Array.from({ length: 20 }, (_, index) => service({ id: `need-${index + 1}` }));
    const exit = await Effect.runPromise(
      createServiceNeededRouteProgram(
        contextWithJson({ name: 'One too many' }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ services: atLimit })), Effect.exit)
    );
    const failure = getFailure(exit);
    expect(failure._tag).toBe('ServicesNeededLimitReachedError');
    expect(failure).toMatchObject({ max: 20 });
  });

  it('drops rate fields the schema does not know', async () => {
    // Schema.Struct ignores excess properties (same as services offered), so a
    // stray rate field must never reach the repo.
    const created: Array<Record<string, unknown>> = [];
    await Effect.runPromise(
      createServiceNeededRouteProgram(
        contextWithJson({ name: 'Tutoring', hourlyRateCents: 3000 }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ onCreate: (input) => created.push(input) })))
    );
    expect(created[0]).not.toHaveProperty('hourlyRateCents');
  });

  it('rejects users without service-needed permission', async () => {
    const exit = await Effect.runPromise(
      listServicesNeededRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false })),
        Effect.exit
      )
    );
    expect(getFailure(exit)._tag).toBe('ForbiddenError');
  });

  it('soft deletes a needed service and schedules a family search reconcile', async () => {
    const reconciledUserIds: Array<string> = [];
    const result = await Effect.runPromise(
      deleteServiceNeededRouteProgram(new Headers(), 'need-1').pipe(
        Effect.provide(makeLayer({ reconciledUserIds }))
      )
    );
    expect(result).toMatchObject({ id: 'need-1', deletedAt: '2026-06-13T00:00:00.000Z' });
    expect(reconciledUserIds).toEqual(['family-1']);
  });
});

describe('services needed catalogue rules', () => {
  const liveItem = catalogueItem();
  const hiddenItem = catalogueItem({
    id: '0197b3a0-0000-7000-8000-000000000002',
    name: 'Homework tutoring',
    category: 'Tutoring',
    isLive: false
  });

  it('creates a need linked to a live catalogue item', async () => {
    const created: Array<{ name: string; catalogueServiceId?: string | null }> = [];
    const result = await Effect.runPromise(
      createServiceNeededRouteProgram(
        contextWithJson({ name: 'Babysitting', catalogueServiceId: liveItem.id }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({ catalogueItems: [liveItem], onCreate: (input) => created.push(input) })
        )
      )
    );

    expect(result).toMatchObject({ catalogueServiceId: liveItem.id });
    expect(created[0]?.catalogueServiceId).toBe(liveItem.id);
  });

  it('rejects creating a need linked to an unknown catalogue item', async () => {
    const exit = await Effect.runPromise(
      createServiceNeededRouteProgram(
        contextWithJson({
          name: 'Babysitting',
          catalogueServiceId: '0197b3a0-0000-7000-8000-00000000dead'
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ catalogueItems: [liveItem] })), Effect.exit)
    );
    expect(getFailure(exit)._tag).toBe('ServiceCatalogueItemNotFoundError');
  });

  it('rejects creating a need linked to a hidden catalogue item', async () => {
    const exit = await Effect.runPromise(
      createServiceNeededRouteProgram(
        contextWithJson({ name: 'Homework tutoring', catalogueServiceId: hiddenItem.id }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ catalogueItems: [hiddenItem] })), Effect.exit)
    );
    expect(getFailure(exit)._tag).toBe('ServiceCatalogueItemHiddenError');
  });

  it('keeps an existing link to a now-hidden item when editing other fields', async () => {
    const existing = service({ catalogueServiceId: hiddenItem.id });
    const result = await Effect.runPromise(
      updateServiceNeededRouteProgram(
        contextWithJson({ description: 'Weekday afternoons' }),
        new Headers(),
        existing.id
      ).pipe(Effect.provide(makeLayer({ existingService: existing, catalogueItems: [hiddenItem] })))
    );
    expect(result).toMatchObject({
      description: 'Weekday afternoons',
      catalogueServiceId: hiddenItem.id
    });
  });

  it('rejects re-linking a need to a hidden catalogue item', async () => {
    const existing = service({ catalogueServiceId: null });
    const exit = await Effect.runPromise(
      updateServiceNeededRouteProgram(
        contextWithJson({ catalogueServiceId: hiddenItem.id }),
        new Headers(),
        existing.id
      ).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [hiddenItem] })),
        Effect.exit
      )
    );
    expect(getFailure(exit)._tag).toBe('ServiceCatalogueItemHiddenError');
  });

  it('unlinks a need from the catalogue with an explicit null', async () => {
    const updates: Array<{ catalogueServiceId?: string | null }> = [];
    const existing = service({ catalogueServiceId: liveItem.id });
    const result = await Effect.runPromise(
      updateServiceNeededRouteProgram(
        contextWithJson({ catalogueServiceId: null }),
        new Headers(),
        existing.id
      ).pipe(
        Effect.provide(
          makeLayer({
            existingService: existing,
            catalogueItems: [liveItem],
            onUpdate: (input) => updates.push(input)
          })
        )
      )
    );
    expect(updates[0]?.catalogueServiceId).toBeNull();
    expect(result).toMatchObject({ catalogueServiceId: null });
  });

  it('clears the description with an explicit null', async () => {
    const updates: Array<{ description?: string | null }> = [];
    const existing = service({ description: 'Old blurb' });
    await Effect.runPromise(
      updateServiceNeededRouteProgram(
        contextWithJson({ description: null }),
        new Headers(),
        existing.id
      ).pipe(
        Effect.provide(
          makeLayer({ existingService: existing, onUpdate: (input) => updates.push(input) })
        )
      )
    );
    expect(updates[0]).toMatchObject({ description: null });
  });
});
