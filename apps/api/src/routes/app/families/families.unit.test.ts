import {
  DBNotFoundError,
  makeApprovalRepoTest,
  makeFamilySearchOutboxRepoTest,
  makeFamilySearchRepoTest,
  makeSessionRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  type Approval,
  type FamilySearchCandidate,
  type Session,
  type User
} from '@repo/db';
import { makeObjectStorageTest, ObjectStorageError } from '@repo/objs';
import { makeFamilySearchQueueTest } from '@repo/queue';
import { makeFamilySearchIndexTest, type FamilySearchDocument } from '@repo/typesense';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { getFamilyRouteProgram, searchFamiliesRouteProgram } from './families.handler';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'provider-1',
  name: 'Provider User',
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

const currentApproval = (userId = 'provider-1'): Approval => ({
  id: '00000000-0000-7000-8000-000000000001',
  userId,
  approvalRequestId: '00000000-0000-7000-8000-000000000002',
  approvedBy: 'admin-1',
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  status: 'approved',
  reason: null,
  notifiedExpiresInOneMonthAt: null,
  notifiedExpiresInTwoWeeksAt: null,
  notifiedExpiresInOneWeekAt: null,
  notifiedExpiresInTwoDaysAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z')
});

const familyDocument = (overrides: Partial<FamilySearchDocument> = {}): FamilySearchDocument => ({
  id: 'family-1',
  userId: 'family-1',
  displayName: 'Family User',
  firstName: 'Family',
  lastName: 'User',
  shortBio: 'Two kids, flexible hours',
  image: 'users/family-1/public/profile-pictures/pic.png',
  city: 'Toronto',
  cityNormalized: 'toronto',
  stateProvince: 'ON',
  country: 'CA',
  location: [43.6532, -79.3832],
  services: ['Childcare'],
  servicesNormalized: ['childcare'],
  serviceDescriptions: ['After-school care'],
  serviceNamesText: 'Childcare',
  updatedAt: new Date('2026-06-12T00:00:00.000Z').getTime(),
  ...overrides
});

const candidate = (
  userId = 'family-1',
  overrides: Partial<FamilySearchCandidate['profile']> = {}
): FamilySearchCandidate => ({
  profile: {
    userId,
    language: 'en',
    firstName: 'Family',
    lastName: 'User',
    gender: null,
    phoneNumber: null,
    dateOfBirth: null,
    address: null,
    city: 'Toronto',
    postalCode: null,
    country: 'CA',
    stateProvince: 'ON',
    shortBio: 'Two kids, flexible hours',
    googlePlaceId: null,
    latitude: 43.6532,
    longitude: -79.3832,
    image: 'users/family-1/public/profile-pictures/pic.png',
    email: 'family@example.com',
    role: 'family',
    banned: false,
    banExpires: null,
    ...overrides
  },
  services: [
    {
      id: '00000000-0000-7000-8000-000000000003',
      userId,
      catalogueServiceId: null,
      name: 'Childcare',
      description: 'After-school care',
      createdAt: new Date('2026-06-12T00:00:00.000Z'),
      updatedAt: new Date('2026-06-12T00:00:00.000Z'),
      deletedAt: null
    }
  ]
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
    hasPermission?: boolean;
    approved?: boolean;
    hasLocation?: boolean;
    documents?: Array<FamilySearchDocument>;
    searchPages?: Array<Array<FamilySearchDocument>>;
    indexTotal?: number;
    candidates?: Array<FamilySearchCandidate>;
    imageUrlError?: ObjectStorageError;
    reconciledUserIds?: Array<string>;
    cityFacets?: Array<{ value: string; count: number }>;
  } = {}
) => {
  const currentUser = options.user ?? user();
  const currentSession = session();
  const searchPages = options.searchPages ?? [options.documents ?? [familyDocument()]];
  const indexTotal = options.indexTotal ?? searchPages.flat().length;
  const candidates = options.candidates ?? [candidate()];

  return Layer.mergeAll(
    makeObjectStorageTest({
      ensureBucketExists: () => Effect.void,
      ensurePublicReadBucket: () => Effect.void,
      createPresignedPutUrl: () =>
        Effect.fail(
          new ObjectStorageError({
            operation: 'presignPutObject',
            bucket: 'unused',
            cause: 'not used'
          })
        ),
      createPresignedGetUrl: (input) =>
        options.imageUrlError
          ? Effect.fail(options.imageUrlError)
          : Effect.succeed({
              url: `https://files.example.com/${input.bucket}/${input.key}?sig=test`,
              expiresAt: new Date('2026-06-12T00:05:00.000Z')
            })
    }),
    makeAuthServiceTest({
      getSession: () =>
        Effect.succeed({ user: { id: currentUser.id }, session: { id: currentSession.id } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeApprovalRepoTest({
      findCurrentByUserId: (userId) =>
        (options.approved ?? true)
          ? Effect.succeed(currentApproval(userId))
          : Effect.fail(new DBNotFoundError({ entity: 'approval', value: userId }))
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
    makeUserProfileRepoTest({
      create: (input) =>
        Effect.succeed({ userId: input.userId, language: input.language } as never),
      findByUserId: (userId) =>
        Effect.succeed({
          userId,
          email: currentUser.email,
          role: currentUser.role,
          language: 'en',
          firstName: 'Provider',
          lastName: 'User',
          gender: null,
          phoneNumber: null,
          dateOfBirth: null,
          address: null,
          city: 'Toronto',
          postalCode: null,
          country: 'CA',
          stateProvince: 'ON',
          shortBio: null,
          googlePlaceId: null,
          latitude: options.hasLocation === false ? null : 43.6532,
          longitude: options.hasLocation === false ? null : -79.3832
        }),
      updateByUserId: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: id })),
      updateLocationByUserId: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: id }))
    }),
    makeFamilySearchRepoTest({
      findCandidateByUserId: (userId) => {
        const found = candidates.find((entry) => entry.profile.userId === userId);
        return found
          ? Effect.succeed(found)
          : Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId }));
      },
      listCandidatesByUserIds: (userIds) =>
        Effect.succeed(candidates.filter((entry) => userIds.includes(entry.profile.userId))),
      listFamilyUserIds: () => Effect.succeed(candidates.map((entry) => entry.profile.userId))
    }),
    makeFamilySearchOutboxRepoTest({
      createPending: (userId) => Effect.succeed({ id: `outbox-${userId}` } as never),
      listUnresolved: () => Effect.succeed([]),
      markProcessing: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'familySearchOutbox', value: id })),
      markProcessed: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'familySearchOutbox', value: id })),
      markFailed: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'familySearchOutbox', value: id })),
      markSupersededBefore: () => Effect.succeed(0)
    }),
    makeFamilySearchQueueTest({
      enqueueReconcile: (input) => {
        options.reconciledUserIds?.push(input.userId);
        return Effect.succeed({ id: 'job-1', name: 'reconcile-family' });
      },
      enqueueReindex: () => Effect.succeed({ id: 'job-3', name: 'reindex-all-families' })
    }),
    makeFamilySearchIndexTest({
      ensureCollection: () => Effect.void,
      reconcileFamily: () => Effect.void,
      reindexAllFamilies: () => Effect.succeed({ indexed: 0, deletedStale: 0 }),
      getFamily: () => Effect.succeed(searchPages[0]?.[0] ?? familyDocument()),
      searchFamilies: (input) =>
        Effect.succeed({
          families: searchPages[input.page - 1] ?? [],
          pagination: { page: input.page, perPage: input.perPage, total: indexTotal }
        }),
      listCityFacets: () => Effect.succeed(options.cityFacets ?? [])
    })
  );
};

describe('family search route program', () => {
  beforeEach(() => {
    process.env.OBJS_KYC_BUCKET = 'kyc-documents';
    process.env.OBJS_PUBLIC_BUCKET = 'public-assets';
  });

  it('returns public family search results', async () => {
    const result = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), { q: 'childcare' }).pipe(
        Effect.provide(makeLayer())
      )
    );

    expect(result.families).toEqual([
      expect.objectContaining({
        userId: 'family-1',
        location: { city: 'Toronto', stateProvince: 'ON', country: 'CA' }
      })
    ]);
    expect(result.families[0]).not.toHaveProperty('location.location');
  });

  it('never exposes rate fields on family results', async () => {
    const result = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), {}).pipe(Effect.provide(makeLayer()))
    );

    expect(result.families[0]).not.toHaveProperty('minHourlyRateCents');
    expect(result.families[0]).not.toHaveProperty('maxHourlyRateCents');
  });

  it('returns city facet options for the filter dropdown', async () => {
    const cityFacets = [
      { value: 'Mississauga', count: 3 },
      { value: 'Port Credit', count: 1 }
    ];
    const result = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), {}).pipe(Effect.provide(makeLayer({ cityFacets })))
    );

    expect(result.facets.city).toEqual(cityFacets);
  });

  it('replaces the stored image key with a presigned URL', async () => {
    const result = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), {}).pipe(Effect.provide(makeLayer()))
    );

    expect(result.families[0]?.image).toBe(
      'https://files.example.com/public-assets/users/family-1/public/profile-pictures/pic.png?sig=test'
    );
  });

  it('returns a null image for families without a profile picture', async () => {
    const result = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), {}).pipe(
        Effect.provide(makeLayer({ candidates: [candidate('family-1', { image: null })] }))
      )
    );

    expect(result.families[0]?.image).toBeNull();
  });

  it('serves current database values instead of stale index values', async () => {
    const result = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), {}).pipe(
        Effect.provide(
          makeLayer({
            documents: [
              familyDocument({
                displayName: 'Stale Name',
                firstName: 'Stale',
                lastName: 'Name',
                shortBio: 'Stale bio'
              })
            ],
            candidates: [candidate()]
          })
        )
      )
    );

    expect(result.families[0]?.displayName).toBe('Family User');
    expect(result.families[0]?.shortBio).toBe('Two kids, flexible hours');
  });

  it('drops index hits the database no longer considers eligible and schedules their reconcile', async () => {
    const reconciledUserIds: Array<string> = [];
    const result = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), {}).pipe(
        Effect.provide(
          makeLayer({
            documents: [
              familyDocument(),
              familyDocument({ id: 'family-2', userId: 'family-2' }),
              familyDocument({ id: 'family-3', userId: 'family-3' })
            ],
            candidates: [
              candidate(),
              candidate('family-2', { banned: true, banExpires: null })
              // family-3 has no candidate at all (deleted user).
            ],
            reconciledUserIds
          })
        )
      )
    );

    expect(result.families.map((family) => family.userId)).toEqual(['family-1']);
    expect(result.pagination.total).toBe(1);
    expect(reconciledUserIds.sort()).toEqual(['family-2', 'family-3']);
  });

  it('backfills the page from later index pages when candidates are stale', async () => {
    const reconciledUserIds: Array<string> = [];
    // perPage=2 -> the handler fetches candidate pages of 4. Page one is
    // entirely stale, so it must fetch index page two to fill the result page.
    const stale = (id: string) => familyDocument({ id, userId: id });
    const result = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), { perPage: '2' }).pipe(
        Effect.provide(
          makeLayer({
            searchPages: [
              [stale('stale-1'), stale('stale-2'), stale('stale-3'), stale('stale-4')],
              [familyDocument({ id: 'family-5', userId: 'family-5' })]
            ],
            indexTotal: 5,
            candidates: [candidate('family-5')],
            reconciledUserIds
          })
        )
      )
    );

    expect(result.families.map((family) => family.userId)).toEqual(['family-5']);
    expect(result.pagination.total).toBe(1);
    expect(reconciledUserIds).toHaveLength(4);
  });

  it('translates image presign failures to ProfileImageUrlError', async () => {
    const exit = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), {}).pipe(
        Effect.provide(
          makeLayer({
            imageUrlError: new ObjectStorageError({
              operation: 'presignGetObject',
              bucket: 'public-assets',
              cause: 'down'
            })
          })
        ),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('ProfileImageUrlError');
  });

  it('rejects lat/lng query parameters', async () => {
    const exit = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), { lat: '43', lng: '-79' }).pipe(
        Effect.provide(makeLayer()),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('FamilySearchRequestValidationError');
  });

  it('requires saved user location for radius search', async () => {
    const exit = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), { radiusKm: '10' }).pipe(
        Effect.provide(makeLayer({ hasLocation: false })),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('FamilySearchRequestValidationError');
  });

  it('requires family search read permission', async () => {
    const exit = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), {}).pipe(
        Effect.provide(makeLayer({ hasPermission: false })),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('ForbiddenError');
  });

  it('rejects providers without a current approval', async () => {
    const exit = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), {}).pipe(
        Effect.provide(makeLayer({ approved: false })),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('ProviderNotApprovedError');
  });

  it('lets admins search without an approval row', async () => {
    const result = await Effect.runPromise(
      searchFamiliesRouteProgram(new Headers(), {}).pipe(
        Effect.provide(
          makeLayer({ user: user({ id: 'provider-1', role: 'admin' }), approved: false })
        )
      )
    );

    expect(result.families).toHaveLength(1);
  });
});

describe('family detail route program', () => {
  beforeEach(() => {
    process.env.OBJS_KYC_BUCKET = 'kyc-documents';
    process.env.OBJS_PUBLIC_BUCKET = 'public-assets';
  });

  it('returns the family detail with needed services and no rates', async () => {
    const result = await Effect.runPromise(
      getFamilyRouteProgram(new Headers(), 'family-1').pipe(Effect.provide(makeLayer()))
    );

    expect(result).toMatchObject({
      userId: 'family-1',
      displayName: 'Family User',
      location: { city: 'Toronto', stateProvince: 'ON', country: 'CA' }
    });
    expect(result.services).toEqual([
      {
        id: '00000000-0000-7000-8000-000000000003',
        name: 'Childcare',
        description: 'After-school care'
      }
    ]);
  });

  it('hides families that fail the eligibility gate', async () => {
    const exit = await Effect.runPromise(
      getFamilyRouteProgram(new Headers(), 'family-1').pipe(
        Effect.provide(
          makeLayer({ candidates: [candidate('family-1', { banned: true, banExpires: null })] })
        ),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('DBNotFoundError');
  });

  it('rejects unapproved providers', async () => {
    const exit = await Effect.runPromise(
      getFamilyRouteProgram(new Headers(), 'family-1').pipe(
        Effect.provide(makeLayer({ approved: false })),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('ProviderNotApprovedError');
  });
});
