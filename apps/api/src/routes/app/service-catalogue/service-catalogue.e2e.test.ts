import {
  EmptyApprovalRepoTest,
  EmptyApprovalRequestRepoTest,
  EmptyKycDocumentRepoTest,
  EmptyKycDocumentTypeRepoTest,
  EmptyServiceOfferedRepoTest,
  EmptySignupIntentRepoTest,
  EmptyUserProfileRepoTest,
  DBNotFoundError,
  makeServiceCatalogueRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type ServiceCatalogueItem,
  type ServiceCatalogueItemCreateInput,
  type ServiceCatalogueItemUpdateInput,
  type Session,
  type User
} from '@repo/db';
import { makeGooglePlacesTest } from '@repo/google';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { makeObjectStorageTest } from '@repo/objs';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../index';
import { makeAuthServiceTest, type AuthSession } from '../../../lib/effect-auth';
import { EmptySigninServiceTest } from '../auth/signin/signin.handler';
import { EmptySignupServiceTest } from '../auth/signup/signup.handler';

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'admin-1',
  name: 'Admin User',
  email: 'admin@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  isAnonymous: false,
  role: 'admin',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null,
  ...overrides
});

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  expiresAt: new Date('2026-07-02T00:00:00.000Z'),
  token: 'session-token',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  ipAddress: null,
  userAgent: null,
  userId: 'admin-1',
  impersonatedBy: null,
  activeOrganizationId: null,
  ...overrides
});

const makeItem = (overrides: Partial<ServiceCatalogueItem> = {}): ServiceCatalogueItem => ({
  id: `item-${crypto.randomUUID()}`,
  name: 'Babysitting',
  category: 'Childcare',
  baseHourlyRateCents: 1800,
  currency: 'CAD',
  isLive: true,
  deletedAt: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  ...overrides
});

const makeInMemoryCatalogueRepo = (items: Array<ServiceCatalogueItem>) => ({
  listActive: () => Effect.succeed(items.filter((item) => item.deletedAt === null)),
  listLive: () => Effect.succeed(items.filter((item) => item.deletedAt === null && item.isLive)),
  findActiveById: (id: string) => {
    const item = items.find((item) => item.id === id && item.deletedAt === null);
    return item
      ? Effect.succeed(item)
      : Effect.fail(new DBNotFoundError({ entity: 'serviceCatalogueItem', value: id }));
  },
  findById: (id: string) => {
    const item = items.find((item) => item.id === id);
    return item
      ? Effect.succeed(item)
      : Effect.fail(new DBNotFoundError({ entity: 'serviceCatalogueItem', value: id }));
  },
  create: (input: ServiceCatalogueItemCreateInput) => {
    const item = makeItem({
      ...input,
      id: 'item-new',
      currency: input.currency ?? 'CAD',
      isLive: input.isLive ?? true
    });
    items.push(item);
    return Effect.succeed(item);
  },
  update: (id: string, input: ServiceCatalogueItemUpdateInput) => {
    const item = items.find((item) => item.id === id && item.deletedAt === null);
    if (!item)
      return Effect.fail(new DBNotFoundError({ entity: 'serviceCatalogueItem', value: id }));
    Object.assign(item, input, { updatedAt: new Date('2026-07-01T00:00:00.000Z') });
    return Effect.succeed(item);
  },
  softDelete: (id: string) => {
    const item = items.find((item) => item.id === id && item.deletedAt === null);
    if (!item)
      return Effect.fail(new DBNotFoundError({ entity: 'serviceCatalogueItem', value: id }));
    item.deletedAt = new Date('2026-07-02T00:00:00.000Z');
    return Effect.succeed(item);
  }
});

const makeApp = (
  options: {
    authSession?: AuthSession | null;
    hasPermission?: boolean;
    user?: User;
    items?: Array<ServiceCatalogueItem>;
  } = {}
) => {
  const user = options.user ?? makeUser();
  const authSession =
    options.authSession === undefined
      ? { user: { id: user.id }, session: { id: 'session-1' } }
      : options.authSession;
  const items = options.items ?? [];
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      makeAuthServiceTest({
        getSession: () => Effect.succeed(authSession),
        userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
      }),
      EmptySignupIntentRepoTest,
      EmptySigninServiceTest,
      EmptySignupServiceTest,
      EmptyUserProfileRepoTest,
      EmptyApprovalRepoTest,
      EmptyApprovalRequestRepoTest,
      EmptyKycDocumentRepoTest,
      EmptyKycDocumentTypeRepoTest,
      EmptyServiceOfferedRepoTest,
      makeGooglePlacesTest({
        lookupPlaceById: () => Effect.die('not used'),
        autocompletePlaces: () => Effect.succeed([])
      }),
      makeObjectStorageTest({
        ensureBucketExists: () => Effect.void,
        ensurePublicReadBucket: () => Effect.void,
        createPresignedPutUrl: () =>
          Effect.succeed({ uploadUrl: 'https://example.com', expiresAt: new Date() }),
        createPresignedGetUrl: () =>
          Effect.succeed({ url: 'https://example.com', expiresAt: new Date() })
      }),
      makeServiceCatalogueRepoTest(makeInMemoryCatalogueRepo(items)),
      makeUserRepoTest({
        findById: (id) =>
          id === user.id
            ? Effect.succeed(user)
            : Effect.fail(new DBNotFoundError({ entity: 'user', value: id })),
        findByEmail: () => Effect.succeed(user)
      }),
      makeSessionRepoTest({
        findById: (id) =>
          id === 'session-1'
            ? Effect.succeed(makeSession({ userId: user.id }))
            : Effect.fail(new DBNotFoundError({ entity: 'session', value: id }))
      })
    )
  );

  return createApp(runtime);
};

describe('/service-catalogue', () => {
  it('lets an admin create, update, and soft delete catalogue items', async () => {
    const items: Array<ServiceCatalogueItem> = [];
    const app = makeApp({ items });

    const createRes = await app.request('/api/v1/admin/service-catalogue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Weekend babysitting',
        category: 'Childcare',
        baseHourlyRateCents: 1900
      })
    });

    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created).toMatchObject({
      name: 'Weekend babysitting',
      baseHourlyRateCents: 1900,
      currency: 'CAD',
      isLive: true
    });

    const patchRes = await app.request(`/api/v1/admin/service-catalogue/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isLive: false })
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).isLive).toBe(false);

    const deleteRes = await app.request(`/api/v1/admin/service-catalogue/${created.id}`, {
      method: 'DELETE'
    });
    expect(deleteRes.status).toBe(200);
    expect((await deleteRes.json()).deletedAt).toBe('2026-07-02T00:00:00.000Z');

    const adminListRes = await app.request('/api/v1/admin/service-catalogue');
    expect(await adminListRes.json()).toEqual([]);
  });

  it('shows providers live items only', async () => {
    const items = [
      makeItem({ id: 'item-live' }),
      makeItem({
        id: 'item-hidden',
        name: 'Homework tutoring',
        category: 'Tutoring',
        isLive: false
      })
    ];
    const app = makeApp({ user: makeUser({ id: 'provider-1', role: 'service-provider' }), items });

    const res = await app.request('/api/v1/service-catalogue');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('item-live');
  });

  it('rejects mutations without the serviceCatalogue write permission', async () => {
    const app = makeApp({
      user: makeUser({ id: 'provider-1', role: 'service-provider' }),
      hasPermission: false
    });

    const res = await app.request('/api/v1/admin/service-catalogue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Weekend babysitting',
        category: 'Childcare',
        baseHourlyRateCents: 1900
      })
    });

    expect(res.status).toBe(403);
  });

  it('returns 404 for updates to unknown items', async () => {
    const app = makeApp({ items: [] });

    const res = await app.request('/api/v1/admin/service-catalogue/item-missing', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isLive: false })
    });

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('SERVICE_CATALOGUE_ITEM_NOT_FOUND');
  });
});
