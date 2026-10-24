import { SqlError } from '@effect/sql/SqlError';
import {
  DBNotFoundError,
  type KycDocument,
  type KycDocumentType,
  makeKycDocumentRepoTest,
  makeKycDocumentTypeRepoTest,
  makeServiceCatalogueRepoTest,
  makeServiceOfferedRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type ServiceCatalogueItem,
  type ServiceOffered,
  type Session,
  type User
} from '@repo/db';
import { makeProviderSearchQueueTest } from '@repo/queue';
import { makeProviderSearchOutboxRepoTest, type ProviderSearchOutbox } from '@repo/db';
import { Cause, ConfigProvider, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  createServiceOfferedRouteProgram,
  deleteServiceOfferedRouteProgram,
  listServicesForReviewRouteProgram,
  listServicesOfferedRouteProgram,
  reviewServiceOfferedRouteProgram,
  updateServiceOfferedRouteProgram
} from './services-offered.handler';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'provider-1',
  name: 'Provider',
  email: 'provider@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  isAnonymous: false,
  role: 'service-provider',
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
  userId: 'provider-1',
  impersonatedBy: null,
  activeOrganizationId: null
});

const service = (overrides: Partial<ServiceOffered> = {}): ServiceOffered => ({
  reviewStatus: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  reviewReason: null,
  id: 'service-1',
  userId: 'provider-1',
  catalogueServiceId: null,
  name: 'Childcare',
  description: null,
  hourlyRateCents: 2500,
  currency: 'CAD',
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  deletedAt: null,
  ...overrides
});

const catalogueItem = (overrides: Partial<ServiceCatalogueItem> = {}): ServiceCatalogueItem => ({
  requiredDocumentTypeId: null,
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

const pswTypeId = '0197b3a0-0000-7000-8000-0000000000d1';
const pswType = (overrides: Partial<KycDocumentType> = {}): KycDocumentType => ({
  id: pswTypeId,
  name: 'Personal Support Worker (PSW)',
  appliesToRole: 'service-provider',
  isOptional: true,
  requiresExpiryDate: false,
  credibledCheckTypeValue: null,
  credibledCostCents: null,
  isSafetyGate: false,
  deletedAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides
});

const kycDocument = (overrides: Partial<KycDocument> = {}): KycDocument => ({
  id: 'doc-1',
  userId: 'provider-1',
  documentTypeId: pswTypeId,
  filename: 'psw.pdf',
  fileKey: 'users/provider-1/kyc/psw.pdf',
  expiryDate: null,
  issuedOn: null,
  status: 'approved',
  source: 'upload',
  reason: null,
  reviewedBy: 'admin-1',
  reviewedAt: new Date('2026-06-12T00:00:00.000Z'),
  deletedAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides
});

const contextWithJson = (body: unknown) =>
  ({ req: { json: async () => body } }) as HonoContext<HonoEnv>;

const outbox = (userId = 'provider-1'): ProviderSearchOutbox => ({
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
    services?: Array<ServiceOffered>;
    existingService?: ServiceOffered;
    catalogueItems?: Array<ServiceCatalogueItem>;
    kycDocuments?: Array<KycDocument>;
    pendingReview?: Array<ServiceOffered>;
    kycError?: SqlError;
    hasPermission?: boolean;
    onReview?: (id: string, input: { status: string; reason: string | null }) => void;
    createError?: SqlError;
    onCreate?: (input: {
      name: string;
      hourlyRateCents: number;
      catalogueServiceId?: string | null;
    }) => void;
    onUpdate?: (input: { hourlyRateCents?: number; catalogueServiceId?: string | null }) => void;
  } = {}
) => {
  const currentUser = options.user ?? user();
  const currentSession = session();
  const existingService = options.existingService ?? service();
  const catalogueItems = options.catalogueItems ?? [];
  return Layer.mergeAll(
    makeKycDocumentRepoTest({
      findByIdWithType: (id) => Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: id })),
      findByUserId: () =>
        options.kycError ? Effect.fail(options.kycError) : Effect.succeed(options.kycDocuments ?? []),
      findByUserIdWithTypes: () => Effect.succeed([]),
      submit: () => Effect.fail(new SqlError({ message: 'not used' })),
      updateExpiryDate: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: id })),
      approveSubmittedByUserId: () => Effect.succeed([])
    }),
    makeKycDocumentTypeRepoTest({
      listActive: () => Effect.succeed([pswType()]),
      findActiveById: (id) =>
        id === pswTypeId
          ? Effect.succeed(pswType())
          : Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: id })),
      create: () => Effect.fail(new SqlError({ message: 'not used' })),
      update: (id) => Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: id })),
      softDelete: (id) => Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: id }))
    }),
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
    makeServiceOfferedRepoTest({
      listByUserId: () => Effect.succeed(options.services ?? [service()]),
      findByIdForUser: (id, userId) =>
        existingService.id === id && existingService.userId === userId
          ? Effect.succeed(existingService)
          : Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: id })),
      create: (input) => {
        options.onCreate?.(input);
        return options.createError
          ? Effect.fail(options.createError)
          : Effect.succeed(service(input));
      },
      updateByIdForUser: (id, _userId, input) => {
        options.onUpdate?.(input);
        return Effect.succeed(service({ ...existingService, ...input, id }));
      },
      softDeleteByIdForUser: (id) =>
        Effect.succeed(service({ id, deletedAt: new Date('2026-06-13T00:00:00.000Z') })),
      listPendingReview: () =>
        Effect.succeed(
          (options.pendingReview ?? []).map((pending) => ({
            ...pending,
            helper: {
              name: 'Provider',
              email: 'provider@example.com',
              firstName: 'Pat',
              lastName: 'Lee'
            }
          }))
        ),
      review: (id, input) => {
        options.onReview?.(id, input);
        const pending = (options.pendingReview ?? []).find((candidate) => candidate.id === id);
        return pending
          ? Effect.succeed(
              service({
                ...pending,
                reviewStatus: input.status,
                reviewedBy: input.reviewedBy,
                reviewReason: input.reason
              })
            )
          : Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: id }));
      }
    }),
    makeProviderSearchQueueTest({
      enqueueReconcile: () => Effect.succeed({ id: 'job-1', name: 'reconcile-provider' }),
      enqueueReindex: () => Effect.succeed({ id: 'job-3', name: 'reindex-all-providers' })
    }),
    makeProviderSearchOutboxRepoTest({
      createPending: (userId) => Effect.succeed(outbox(userId)),
      listUnresolved: () => Effect.succeed([]),
      markProcessing: (id) => Effect.succeed(outbox(id)),
      markProcessed: (id) => Effect.succeed(outbox(id)),
      markFailed: (id) => Effect.succeed(outbox(id)),
      markSupersededBefore: () => Effect.succeed(0)
    })
  );
};

describe('services offered route programs', () => {
  it('lists service offerings for the authenticated provider with the provider limit', async () => {
    const result = await Effect.runPromise(
      listServicesOfferedRouteProgram(new Headers()).pipe(Effect.provide(makeLayer()))
    );
    expect(result.services).toEqual([
      expect.objectContaining({
        id: 'service-1',
        name: 'Childcare',
        createdAt: '2026-06-12T00:00:00.000Z'
      })
    ]);
    expect(result.maxServicesOffered).toBe(20);
  });

  it('reads the provider limit from SERVICES_OFFERED_MAX_PER_PROVIDER', async () => {
    const result = await Effect.runPromise(
      listServicesOfferedRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer()),
        Effect.withConfigProvider(
          ConfigProvider.fromMap(new Map([['SERVICES_OFFERED_MAX_PER_PROVIDER', '5']]))
        )
      )
    );
    expect(result.maxServicesOffered).toBe(5);
  });

  it('creates a service offering with default currency', async () => {
    const created: Array<{ name: string; hourlyRateCents: number }> = [];
    const result = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({ name: 'Tutoring', hourlyRateCents: 3000 }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ onCreate: (input) => created.push(input) })))
    );

    expect(result).toMatchObject({ name: 'Tutoring', hourlyRateCents: 3000, currency: 'CAD' });
    expect(created).toEqual([expect.objectContaining({ name: 'Tutoring', hourlyRateCents: 3000 })]);
  });

  it('rejects creating a service once the provider limit is reached', async () => {
    const atLimit = Array.from({ length: 20 }, (_, index) =>
      service({ id: `service-${index + 1}` })
    );
    const exit = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({ name: 'One too many', hourlyRateCents: 3000 }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ services: atLimit })), Effect.exit)
    );
    const failure = getFailure(exit);
    expect(failure._tag).toBe('ServicesOfferedLimitReachedError');
    expect(failure).toMatchObject({ max: 20 });
  });

  it('enforces a lowered SERVICES_OFFERED_MAX_PER_PROVIDER on create', async () => {
    const exit = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({ name: 'Second service', hourlyRateCents: 3000 }),
        new Headers()
      ).pipe(
        Effect.provide(makeLayer({ services: [service()] })),
        Effect.withConfigProvider(
          ConfigProvider.fromMap(new Map([['SERVICES_OFFERED_MAX_PER_PROVIDER', '1']]))
        ),
        Effect.exit
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ServicesOfferedLimitReachedError', max: 1 });
  });

  it('rejects users without service-offered permission', async () => {
    const exit = await Effect.runPromise(
      listServicesOfferedRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false })),
        Effect.exit
      )
    );
    expect(getFailure(exit)._tag).toBe('ForbiddenError');
  });

  it('soft deletes a service offering', async () => {
    const result = await Effect.runPromise(
      deleteServiceOfferedRouteProgram(new Headers(), 'service-1').pipe(Effect.provide(makeLayer()))
    );
    expect(result).toMatchObject({ id: 'service-1', deletedAt: '2026-06-13T00:00:00.000Z' });
  });
});

describe('services offered catalogue rules', () => {
  const liveItem = catalogueItem();
  const hiddenItem = catalogueItem({
    id: '0197b3a0-0000-7000-8000-000000000002',
    name: 'Homework tutoring',
    category: 'Tutoring',
    baseHourlyRateCents: 2400,
    isLive: false
  });

  it('creates a service linked to a live catalogue item at or above the floor', async () => {
    const created: Array<{
      name: string;
      hourlyRateCents: number;
      catalogueServiceId?: string | null;
    }> = [];
    const result = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({
          name: 'Babysitting',
          hourlyRateCents: 1800,
          catalogueServiceId: liveItem.id
        }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({ catalogueItems: [liveItem], onCreate: (input) => created.push(input) })
        )
      )
    );

    expect(result).toMatchObject({ hourlyRateCents: 1800, catalogueServiceId: liveItem.id });
    expect(created[0]?.catalogueServiceId).toBe(liveItem.id);
  });

  it('rejects creating a linked service below the floor', async () => {
    const exit = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({
          name: 'Babysitting',
          hourlyRateCents: 1700,
          catalogueServiceId: liveItem.id
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ catalogueItems: [liveItem] })), Effect.exit)
    );
    const failure = getFailure(exit);
    expect(failure._tag).toBe('ServiceRateBelowFloorError');
    expect(failure).toMatchObject({ floorCents: 1800 });
  });

  it('rejects creating a service linked to an unknown catalogue item', async () => {
    const exit = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({
          name: 'Babysitting',
          hourlyRateCents: 2000,
          catalogueServiceId: '0197b3a0-0000-7000-8000-00000000dead'
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ catalogueItems: [liveItem] })), Effect.exit)
    );
    expect(getFailure(exit)._tag).toBe('ServiceCatalogueItemNotFoundError');
  });

  it('rejects creating a service linked to a hidden catalogue item', async () => {
    const exit = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({
          name: 'Homework tutoring',
          hourlyRateCents: 2400,
          catalogueServiceId: hiddenItem.id
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ catalogueItems: [hiddenItem] })), Effect.exit)
    );
    expect(getFailure(exit)._tag).toBe('ServiceCatalogueItemHiddenError');
  });

  it('re-validates the floor when the rate of a linked service is updated', async () => {
    const existing = service({ catalogueServiceId: liveItem.id, hourlyRateCents: 2000 });
    const exit = await Effect.runPromise(
      updateServiceOfferedRouteProgram(
        contextWithJson({ hourlyRateCents: 1500 }),
        new Headers(),
        existing.id
      ).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [liveItem] })),
        Effect.exit
      )
    );
    expect(getFailure(exit)._tag).toBe('ServiceRateBelowFloorError');
  });

  it('allows keeping an existing link to a now-hidden item when editing the rate', async () => {
    const existing = service({ catalogueServiceId: hiddenItem.id, hourlyRateCents: 2400 });
    const result = await Effect.runPromise(
      updateServiceOfferedRouteProgram(
        contextWithJson({ hourlyRateCents: 2600 }),
        new Headers(),
        existing.id
      ).pipe(Effect.provide(makeLayer({ existingService: existing, catalogueItems: [hiddenItem] })))
    );
    expect(result).toMatchObject({ hourlyRateCents: 2600, catalogueServiceId: hiddenItem.id });
  });

  it('rejects re-linking a service to a hidden catalogue item', async () => {
    const existing = service({ catalogueServiceId: null, hourlyRateCents: 2600 });
    const exit = await Effect.runPromise(
      updateServiceOfferedRouteProgram(
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

  it('unlinks a service from the catalogue with an explicit null', async () => {
    const updates: Array<{ catalogueServiceId?: string | null }> = [];
    const existing = service({ catalogueServiceId: liveItem.id });
    const result = await Effect.runPromise(
      updateServiceOfferedRouteProgram(
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

  it('applies the custom-service floor, not the old link floor, when unlinking', async () => {
    // Regression: loose equality (== undefined) once conflated explicit null
    // with "absent", so the removed link's floor was wrongly enforced here.
    // An unlinked service is custom, so the platform base rate applies.
    const existing = service({ catalogueServiceId: liveItem.id, hourlyRateCents: 2500 });
    const result = await Effect.runPromise(
      updateServiceOfferedRouteProgram(
        contextWithJson({ catalogueServiceId: null, hourlyRateCents: 2000 }),
        new Headers(),
        existing.id
      ).pipe(Effect.provide(makeLayer({ existingService: existing, catalogueItems: [liveItem] })))
    );
    expect(result).toMatchObject({ catalogueServiceId: null, hourlyRateCents: 2000 });
    // Unlinked = custom = back to the admin.
    expect(result.reviewStatus).toBe('pending');

    const exit = await Effect.runPromise(
      updateServiceOfferedRouteProgram(
        contextWithJson({ catalogueServiceId: null, hourlyRateCents: 100 }),
        new Headers(),
        existing.id
      ).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [liveItem] })),
        Effect.exit
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'ServiceRateBelowFloorError',
      floorCents: 2000
    });
  });

  it('clears the description with an explicit null', async () => {
    const updates: Array<{ description?: string | null }> = [];
    const existing = service({ description: 'Old blurb' });
    await Effect.runPromise(
      updateServiceOfferedRouteProgram(
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

  it('treats a link to a soft-deleted item like a hidden one when editing the rate', async () => {
    const deletedItem = catalogueItem({
      id: '0197b3a0-0000-7000-8000-000000000003',
      deletedAt: new Date('2026-07-01T00:00:00.000Z')
    });
    const existing = service({ catalogueServiceId: deletedItem.id, hourlyRateCents: 1800 });

    const raised = await Effect.runPromise(
      updateServiceOfferedRouteProgram(
        contextWithJson({ hourlyRateCents: 2000 }),
        new Headers(),
        existing.id
      ).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [deletedItem] }))
      )
    );
    expect(raised).toMatchObject({ hourlyRateCents: 2000, catalogueServiceId: deletedItem.id });

    const lowered = await Effect.runPromise(
      updateServiceOfferedRouteProgram(
        contextWithJson({ hourlyRateCents: 100 }),
        new Headers(),
        existing.id
      ).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [deletedItem] })),
        Effect.exit
      )
    );
    expect(getFailure(lowered)._tag).toBe('ServiceRateBelowFloorError');
  });

  it('rejects linking to a soft-deleted catalogue item', async () => {
    const deletedItem = catalogueItem({
      id: '0197b3a0-0000-7000-8000-000000000003',
      deletedAt: new Date('2026-07-01T00:00:00.000Z')
    });
    const existing = service({ catalogueServiceId: null, hourlyRateCents: 2500 });
    const exit = await Effect.runPromise(
      updateServiceOfferedRouteProgram(
        contextWithJson({ catalogueServiceId: deletedItem.id }),
        new Headers(),
        existing.id
      ).pipe(
        Effect.provide(makeLayer({ existingService: existing, catalogueItems: [deletedItem] })),
        Effect.exit
      )
    );
    expect(getFailure(exit)._tag).toBe('ServiceCatalogueItemNotFoundError');
  });
});

describe('custom services and the credential gate (UAT #1, #18, #34)', () => {
  const pswItem = catalogueItem({
    id: '0197b3a0-0000-7000-8000-000000000010',
    name: 'Personal support (PSW)',
    category: 'Elderly Care',
    baseHourlyRateCents: 2500,
    requiredDocumentTypeId: pswTypeId
  });

  it('creates a custom service as pending review', async () => {
    const created: Array<Record<string, unknown>> = [];
    const result = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({ name: 'Garden design', hourlyRateCents: 2000 }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ onCreate: (input) => created.push(input) })))
    );
    expect(created[0]).toMatchObject({ reviewStatus: 'pending', catalogueServiceId: null });
    expect(result.reviewStatus).toBe('pending');
  });

  it('rejects a custom service below the platform base rate', async () => {
    const exit = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({ name: 'Personal care', hourlyRateCents: 500 }),
        new Headers()
      ).pipe(Effect.provide(makeLayer()), Effect.exit)
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'ServiceRateBelowFloorError',
      floorCents: 2000
    });
  });

  it('rejects raising a custom service rate below the base rate on update', async () => {
    const exit = await Effect.runPromise(
      updateServiceOfferedRouteProgram(
        contextWithJson({ hourlyRateCents: 1500 }),
        new Headers(),
        'service-1'
      ).pipe(Effect.provide(makeLayer()), Effect.exit)
    );
    expect(getFailure(exit)._tag).toBe('ServiceRateBelowFloorError');
  });

  it('keeps the review decision when only the rate of a custom service changes', async () => {
    const updates: Array<Record<string, unknown>> = [];
    await Effect.runPromise(
      updateServiceOfferedRouteProgram(
        contextWithJson({ hourlyRateCents: 3000 }),
        new Headers(),
        'service-1'
      ).pipe(Effect.provide(makeLayer({ onUpdate: (input) => updates.push(input) })))
    );
    expect(updates[0]).not.toHaveProperty('reviewStatus');
  });

  it('sends a reworded custom service back to review', async () => {
    const updates: Array<Record<string, unknown>> = [];
    await Effect.runPromise(
      updateServiceOfferedRouteProgram(
        contextWithJson({ name: 'Childcare and personal care' }),
        new Headers(),
        'service-1'
      ).pipe(Effect.provide(makeLayer({ onUpdate: (input) => updates.push(input) })))
    );
    expect(updates[0]).toMatchObject({ reviewStatus: 'pending', reviewedBy: null });
  });

  it('names a linked service after its catalogue item and approves it', async () => {
    const liveItem = catalogueItem();
    const created: Array<Record<string, unknown>> = [];
    await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({
          name: 'PSW care (not really babysitting)',
          hourlyRateCents: 1800,
          catalogueServiceId: liveItem.id
        }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({ catalogueItems: [liveItem], onCreate: (input) => created.push(input) })
        )
      )
    );
    expect(created[0]).toMatchObject({ name: 'Babysitting', reviewStatus: 'approved' });
  });

  it('refuses the PSW service without an approved PSW credential', async () => {
    for (const kycDocuments of [[], [kycDocument({ status: 'submitted' })]]) {
      const exit = await Effect.runPromise(
        createServiceOfferedRouteProgram(
          contextWithJson({
            name: 'Personal support (PSW)',
            hourlyRateCents: 2500,
            catalogueServiceId: pswItem.id
          }),
          new Headers()
        ).pipe(
          Effect.provide(makeLayer({ catalogueItems: [pswItem], kycDocuments })),
          Effect.exit
        )
      );
      expect(getFailure(exit)).toMatchObject({
        _tag: 'ServiceCredentialRequiredError',
        documentTypeId: pswTypeId,
        documentTypeName: 'Personal Support Worker (PSW)'
      });
    }
  });

  it('adds the PSW service once the credential is approved', async () => {
    const result = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({
          name: 'Personal support (PSW)',
          hourlyRateCents: 2500,
          catalogueServiceId: pswItem.id
        }),
        new Headers()
      ).pipe(
        Effect.provide(makeLayer({ catalogueItems: [pswItem], kycDocuments: [kycDocument()] }))
      )
    );
    expect(result).toMatchObject({ catalogueServiceId: pswItem.id, reviewStatus: 'approved' });
  });

  it('checks the credential when re-linking an existing service to the PSW item', async () => {
    const exit = await Effect.runPromise(
      updateServiceOfferedRouteProgram(
        contextWithJson({ catalogueServiceId: pswItem.id }),
        new Headers(),
        'service-1'
      ).pipe(
        Effect.provide(makeLayer({ catalogueItems: [pswItem], kycDocuments: [] })),
        Effect.exit
      )
    );
    expect(getFailure(exit)._tag).toBe('ServiceCredentialRequiredError');
  });

  it('surfaces a document lookup failure as a repo error', async () => {
    const exit = await Effect.runPromise(
      createServiceOfferedRouteProgram(
        contextWithJson({
          name: 'Personal support (PSW)',
          hourlyRateCents: 2500,
          catalogueServiceId: pswItem.id
        }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            catalogueItems: [pswItem],
            kycError: new SqlError({ cause: new Error('boom'), message: 'boom' })
          })
        ),
        Effect.exit
      )
    );
    expect(getFailure(exit)._tag).toBe('SqlError');
  });

  it('reports the custom-service base rate on the list endpoint', async () => {
    const result = await Effect.runPromise(
      listServicesOfferedRouteProgram(new Headers()).pipe(Effect.provide(makeLayer()))
    );
    expect(result.customServiceBaseRateCents).toBe(2000);
  });
});

describe('admin review of custom services', () => {
  const pending = service({ id: 'pending-1', reviewStatus: 'pending', name: 'Garden design' });

  it('lists pending services with the helper', async () => {
    const result = await Effect.runPromise(
      listServicesForReviewRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ pendingReview: [pending] }))
      )
    );
    expect(result.services).toEqual([
      expect.objectContaining({
        id: 'pending-1',
        reviewStatus: 'pending',
        helper: expect.objectContaining({ firstName: 'Pat' })
      })
    ]);
  });

  it('approves a pending service and records the reviewer', async () => {
    const reviews: Array<{ id: string; status: string; reason: string | null }> = [];
    const result = await Effect.runPromise(
      reviewServiceOfferedRouteProgram(
        contextWithJson({ decision: 'approve' }),
        new Headers(),
        'pending-1'
      ).pipe(
        Effect.provide(
          makeLayer({
            user: user({ id: 'provider-1', role: 'admin' }),
            pendingReview: [pending],
            onReview: (id, input) => reviews.push({ id, ...input })
          })
        )
      )
    );
    expect(reviews).toEqual([
      expect.objectContaining({ id: 'pending-1', status: 'approved', reason: null })
    ]);
    expect(result).toMatchObject({ reviewStatus: 'approved', reviewedBy: 'provider-1' });
  });

  it('requires a reason to reject', async () => {
    const exit = await Effect.runPromise(
      reviewServiceOfferedRouteProgram(
        contextWithJson({ decision: 'reject', reason: '  ' }),
        new Headers(),
        'pending-1'
      ).pipe(Effect.provide(makeLayer({ pendingReview: [pending] })), Effect.exit)
    );
    expect(getFailure(exit)._tag).toBe('ServiceReviewReasonRequiredError');
  });

  it('rejects with a reason', async () => {
    const result = await Effect.runPromise(
      reviewServiceOfferedRouteProgram(
        contextWithJson({ decision: 'reject', reason: 'Describes personal care — needs PSW.' }),
        new Headers(),
        'pending-1'
      ).pipe(Effect.provide(makeLayer({ pendingReview: [pending] })))
    );
    expect(result).toMatchObject({
      reviewStatus: 'rejected',
      reviewReason: 'Describes personal care — needs PSW.'
    });
  });

  it('maps a service that is no longer pending to ServiceReviewNotPendingError', async () => {
    const exit = await Effect.runPromise(
      reviewServiceOfferedRouteProgram(
        contextWithJson({ decision: 'approve' }),
        new Headers(),
        'gone'
      ).pipe(Effect.provide(makeLayer({ pendingReview: [pending] })), Effect.exit)
    );
    expect(getFailure(exit)._tag).toBe('ServiceReviewNotPendingError');
  });

  it('rejects invalid review input', async () => {
    const exit = await Effect.runPromise(
      reviewServiceOfferedRouteProgram(
        contextWithJson({ decision: 'maybe' }),
        new Headers(),
        'pending-1'
      ).pipe(Effect.provide(makeLayer({ pendingReview: [pending] })), Effect.exit)
    );
    expect(getFailure(exit)._tag).toBe('RequestValidationError');
  });

  it('denies reviewers without the serviceOffered review permission', async () => {
    for (const program of [
      listServicesForReviewRouteProgram(new Headers()),
      reviewServiceOfferedRouteProgram(
        contextWithJson({ decision: 'approve' }),
        new Headers(),
        'pending-1'
      )
    ]) {
      const exit = await Effect.runPromise(
        (program as Effect.Effect<unknown, { _tag: string }, never>).pipe(
          Effect.provide(makeLayer({ hasPermission: false, pendingReview: [pending] })),
          Effect.exit
        )
      );
      expect(getFailure(exit)._tag).toBe('ForbiddenError');
    }
  });
});
