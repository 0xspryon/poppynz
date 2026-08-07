import {
  DBNotFoundError,
  dummyReferral,
  makeReferralRepoTest,
  makeSessionRepoTest,
  makeSignupIntentRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  type Referral,
  type ReferralWithReferred,
  type SafeUserProfile,
  type Session,
  type SignupIntent,
  type User
} from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { makeMailerTest, type ReferralInviteMail } from '@/api/lib/mailer';
import { createReferralRouteProgram, listReferralsRouteProgram } from './referrals.handler';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'referrer-1',
  name: 'Referrer',
  email: 'referrer@example.com',
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
  userId: 'referrer-1',
  impersonatedBy: null,
  activeOrganizationId: null
});

const profile = (): SafeUserProfile => ({
  userId: 'referrer-1',
  email: 'referrer@example.com',
  role: 'service-provider',
  language: 'en',
  firstName: 'Maria',
  lastName: 'Santos',
  gender: null,
  phoneNumber: null,
  dateOfBirth: null,
  address: null,
  city: null,
  postalCode: null,
  country: null,
  stateProvince: null,
  shortBio: null,
  googlePlaceId: null,
  latitude: null,
  longitude: null
});

const referredEntry = (overrides: Partial<ReferralWithReferred> = {}): ReferralWithReferred => ({
  ...dummyReferral,
  referredFirstName: null,
  referredLastName: null,
  referredVerified: false,
  ...overrides
});

const contextWithJson = (body: unknown) =>
  ({ req: { json: async () => body }, get: () => 'en' }) as unknown as HonoContext<HonoEnv>;

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

const makeLayer = (
  options: {
    hasPermission?: boolean;
    referrals?: Array<ReferralWithReferred>;
    pendingReferral?: Referral | null;
    existingUserForEmail?: boolean;
    onCreateReferral?: (input: {
      referrerUserId: string;
      email: string;
      role: string;
      expiresAt: Date;
    }) => void;
    onCreateIntent?: (input: {
      email: string;
      role: string;
      language: string;
      expiresAt: Date;
    }) => void;
    onSendInvite?: (mail: ReferralInviteMail) => void;
  } = {}
) => {
  const currentUser = user();
  return Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () =>
        Effect.succeed({ user: { id: currentUser.id }, session: { id: 'session-1' } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeUserRepoTest({
      findById: () => Effect.succeed(currentUser),
      findByEmail: (email) =>
        options.existingUserForEmail
          ? Effect.succeed(user({ id: 'member-1', email }))
          : Effect.fail(new DBNotFoundError({ entity: 'user', value: email }))
    }),
    makeSessionRepoTest({ findById: () => Effect.succeed(session()) }),
    makeUserProfileRepoTest({
      create: () => Effect.die('not used'),
      findByUserId: () => Effect.succeed(profile()),
      updateByUserId: () => Effect.die('not used'),
      updateLocationByUserId: () => Effect.die('not used')
    }),
    makeSignupIntentRepoTest({
      create: (input) => {
        options.onCreateIntent?.(input);
        return Effect.succeed({
          id: 'intent-1',
          email: input.email,
          role: input.role,
          language: input.language,
          expiresAt: input.expiresAt,
          consumedAt: null,
          createdAt: new Date()
        } satisfies SignupIntent);
      },
      findValidByEmail: () => Effect.succeed(null),
      consumeByEmail: () => Effect.die('not used')
    }),
    makeReferralRepoTest({
      create: (input) => {
        options.onCreateReferral?.(input);
        return Effect.succeed({
          ...dummyReferral,
          email: input.email,
          role: input.role,
          referrerUserId: input.referrerUserId,
          expiresAt: input.expiresAt
        });
      },
      listByReferrer: () => Effect.succeed(options.referrals ?? []),
      findPendingByReferrerAndEmail: () => Effect.succeed(options.pendingReferral ?? null),
      markJoinedByEmail: () => Effect.succeed([])
    }),
    makeMailerTest({
      sendReferralInvite: (mail) => {
        options.onSendInvite?.(mail);
        return Effect.void;
      }
    })
  );
};

describe('GET /referrals', () => {
  it('derives statuses and stats from the referral rows', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const layer = makeLayer({
      referrals: [
        referredEntry({
          id: 'r-joined',
          referredUserId: 'referred-1',
          joinedAt: new Date('2026-07-02T00:00:00.000Z'),
          referredFirstName: 'Rosa',
          referredLastName: 'Benitez',
          referredVerified: true,
          expiresAt: past
        }),
        referredEntry({ id: 'r-pending', expiresAt: future }),
        referredEntry({ id: 'r-expired', expiresAt: past })
      ]
    });

    const result = await Effect.runPromise(
      listReferralsRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );

    expect(result.stats).toEqual({ sent: 3, joined: 1, verified: 1 });
    expect(result.referrals.map((entry) => [entry.id, entry.status])).toEqual([
      ['r-joined', 'joined'],
      ['r-pending', 'invited'],
      ['r-expired', 'expired']
    ]);
    expect(result.referrals[0]?.name).toBe('Rosa Benitez');
    expect(result.referrals[1]?.name).toBeNull();
  });

  it('fails with ForbiddenError when the referral read permission is missing', async () => {
    const exit = await Effect.runPromiseExit(
      listReferralsRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false }))
      )
    );

    expect(getFailure(exit)).toMatchObject({ _tag: 'ForbiddenError' });
  });
});

describe('POST /referrals', () => {
  it('creates a signup intent and referral, then sends the invite', async () => {
    const created: Array<{ email: string; role: string }> = [];
    const intents: Array<{ email: string; role: string; language: string }> = [];
    const mails: Array<ReferralInviteMail> = [];
    const layer = makeLayer({
      onCreateReferral: (input) => created.push(input),
      onCreateIntent: (input) => intents.push(input),
      onSendInvite: (mail) => mails.push(mail)
    });

    const result = await Effect.runPromise(
      createReferralRouteProgram(
        contextWithJson({ email: 'Rosa.Friend@Gmail.com', role: 'service-provider' }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(created).toEqual([
      expect.objectContaining({
        email: 'rosa.friend@gmail.com',
        role: 'service-provider',
        referrerUserId: 'referrer-1'
      })
    ]);
    expect(intents).toEqual([
      expect.objectContaining({
        email: 'rosa.friend@gmail.com',
        role: 'service-provider',
        language: 'en'
      })
    ]);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.inviterName).toBe('Maria Santos');
    expect(mails[0]?.link).toContain(
      '/auth/sign-up?email=rosa.friend%40gmail.com&role=service-provider'
    );
    expect(result.status).toBe('invited');
  });

  it('rejects an email that already belongs to a member', async () => {
    const exit = await Effect.runPromiseExit(
      createReferralRouteProgram(
        contextWithJson({ email: 'member@example.com', role: 'family' }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ existingUserForEmail: true })))
    );

    expect(getFailure(exit)).toMatchObject({ _tag: 'ReferralEmailAlreadyMemberError' });
  });

  it('rejects a duplicate pending invite from the same referrer', async () => {
    const exit = await Effect.runPromiseExit(
      createReferralRouteProgram(
        contextWithJson({ email: 'invitee@example.com', role: 'family' }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            pendingReferral: { ...dummyReferral, expiresAt: new Date(Date.now() + 1000) }
          })
        )
      )
    );

    expect(getFailure(exit)).toMatchObject({ _tag: 'ReferralAlreadyInvitedError' });
  });

  it('rejects invalid input before touching auth', async () => {
    const exit = await Effect.runPromiseExit(
      createReferralRouteProgram(
        contextWithJson({ email: 'not-an-email', role: 'admin' }),
        new Headers()
      ).pipe(Effect.provide(makeLayer()))
    );

    expect(getFailure(exit)).toMatchObject({
      _tag: 'RequestValidationError',
      code: 'INVALID_REFERRAL_INPUT'
    });
  });
});
