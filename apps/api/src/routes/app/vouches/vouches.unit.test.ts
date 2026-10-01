import {
  DBNotFoundError,
  dummyVouch,
  makeApprovalRepoTest,
  makeSessionRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  makeVouchRepoTest,
  type Approval,
  type Session,
  type User,
  type Vouch,
  type VouchTransition,
  type VouchWithVoucher
} from '@repo/db';
import { makeNotificationHubTest } from '@repo/notify';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { makeMailerTest, type VouchRequestMail } from '@/api/lib/mailer';
import {
  adminVouchActionProgram,
  listMyVouchesProgram,
  requestVouchProgram,
  submitVouchProgram,
  withdrawVouchProgram
} from './vouches.handler';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'applicant-1',
  name: 'Ana Applicant',
  email: 'ana@example.com',
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

const session = (userId: string): Session => ({
  id: 'session-1',
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  token: 'token',
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ipAddress: null,
  userAgent: null,
  userId,
  impersonatedBy: null,
  activeOrganizationId: null
});

const applicant = user();
const voucher = user({
  id: 'voucher-1',
  name: 'Vera Voucher',
  email: 'vera@example.com',
  role: 'family'
});
const asSession = (u: User) => ({ user: u as never, session: session(u.id) });

const liveApproval = (userId: string) =>
  ({
    id: `approval-${userId}`,
    userId,
    status: 'approved',
    expiresAt: new Date('2099-01-01')
  }) as Approval;

const makeLayer = (
  options: {
    approved?: Record<string, boolean>;
    vouch?: Vouch;
    openPair?: Vouch | null;
    listed?: Array<VouchWithVoucher>;
    transitionResult?: Vouch | null;
    onCreate?: (input: unknown) => void;
    onTransition?: (input: VouchTransition) => void;
    sent?: Array<VouchRequestMail>;
  } = {}
) =>
  Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () =>
        Effect.succeed({ user: { id: applicant.id }, session: { id: 'session-1' } }),
      userHasPermission: () => Effect.succeed(true)
    }),
    makeSessionRepoTest({ findById: () => Effect.succeed(session(applicant.id)) }),
    makeUserRepoTest({
      findById: (id) => (id === voucher.id ? Effect.succeed(voucher) : Effect.succeed(applicant)),
      findByEmail: (email) =>
        email === voucher.email
          ? Effect.succeed(voucher)
          : email === applicant.email
            ? Effect.succeed(applicant)
            : Effect.fail(new DBNotFoundError({ entity: 'user', value: email }))
    }),
    makeUserProfileRepoTest({
      create: () => Effect.die('not used'),
      findByUserId: () => Effect.fail(new DBNotFoundError({ entity: 'profile', value: '' })),
      updateByUserId: () => Effect.die('not used'),
      updateLocationByUserId: () => Effect.die('not used')
    }),
    makeApprovalRepoTest({
      findCurrentByUserId: (userId) =>
        (options.approved?.[userId] ?? true)
          ? Effect.succeed(liveApproval(userId))
          : Effect.fail(new DBNotFoundError({ entity: 'approval', value: userId }))
    }),
    makeVouchRepoTest({
      create: (input) => {
        options.onCreate?.(input);
        return Effect.succeed({ ...dummyVouch, ...input });
      },
      findById: (id) =>
        options.vouch
          ? Effect.succeed(options.vouch)
          : Effect.fail(new DBNotFoundError({ entity: 'vouch', value: id })),
      findOpenByPair: () => Effect.succeed(options.openPair ?? null),
      listForApplicants: () => Effect.succeed(options.listed ?? []),
      listForVoucher: () => Effect.succeed([]),
      transition: (input) => {
        options.onTransition?.(input);
        return Effect.succeed(
          options.transitionResult === undefined
            ? { ...(options.vouch ?? dummyVouch), ...input.set }
            : options.transitionResult
        );
      }
    }),
    makeMailerTest({
      sendVouchRequest: (mail) => {
        options.sent?.push(mail);
        return Effect.void;
      }
    }),
    makeNotificationHubTest({ publish: () => Effect.void, subscribe: () => Effect.die('not used') })
  );

const failureOf = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected failure');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

const ctx = { uiOrigin: 'http://localhost:5173' };
const answers = {
  howKnow: 'Neighbour',
  howLong: '3 years',
  wouldTrust: 'yes' as const,
  hasConcerns: false,
  wouldHire: 'yes' as const,
  attested: true as const
};

describe('requestVouchProgram', () => {
  it('creates a pending vouch and emails the voucher', async () => {
    const created: Array<unknown> = [];
    const sent: Array<VouchRequestMail> = [];
    const result = await Effect.runPromise(
      requestVouchProgram(
        asSession(applicant),
        { email: voucher.email, relationship: 'Neighbour' },
        ctx
      ).pipe(Effect.provide(makeLayer({ onCreate: (i) => created.push(i), sent })))
    );
    expect(created[0]).toMatchObject({
      applicantUserId: applicant.id,
      voucherUserId: voucher.id,
      voucherRole: 'family'
    });
    expect(sent[0]).toMatchObject({
      email: voucher.email,
      link: 'http://localhost:5173/family/vouches'
    });
    expect(result.status).toBe('pending');
  });

  it('refuses the applicant themself with the same vague error as an unknown email', async () => {
    const self = await Effect.runPromiseExit(
      requestVouchProgram(
        asSession(applicant),
        { email: applicant.email, relationship: 'Me' },
        ctx
      ).pipe(Effect.provide(makeLayer()))
    );
    const unknown = await Effect.runPromiseExit(
      requestVouchProgram(
        asSession(applicant),
        { email: 'nobody@x.dev', relationship: 'X' },
        ctx
      ).pipe(Effect.provide(makeLayer()))
    );
    expect(failureOf(self)).toMatchObject({ _tag: 'VoucherUnavailableError' });
    expect(failureOf(unknown)).toMatchObject({ _tag: 'VoucherUnavailableError' });
  });

  it('refuses a voucher without a live approval', async () => {
    const exit = await Effect.runPromiseExit(
      requestVouchProgram(
        asSession(applicant),
        { email: voucher.email, relationship: 'X' },
        ctx
      ).pipe(Effect.provide(makeLayer({ approved: { [voucher.id]: false } })))
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VoucherUnavailableError' });
  });

  it('refuses a second open request to the same voucher', async () => {
    const exit = await Effect.runPromiseExit(
      requestVouchProgram(
        asSession(applicant),
        { email: voucher.email, relationship: 'X' },
        ctx
      ).pipe(Effect.provide(makeLayer({ openPair: dummyVouch })))
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchAlreadyRequestedError' });
  });

  it('only lets helpers ask for vouches', async () => {
    const exit = await Effect.runPromiseExit(
      requestVouchProgram(
        asSession(voucher),
        { email: applicant.email, relationship: 'X' },
        ctx
      ).pipe(Effect.provide(makeLayer()))
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchApplicantOnlyError' });
  });
});

describe('listMyVouchesProgram', () => {
  it('hides answers and collapses flagged into not_counted', async () => {
    const flagged: VouchWithVoucher = {
      ...dummyVouch,
      status: 'flagged',
      answers: {
        howKnow: 'x',
        howLong: 'y',
        wouldTrust: 'no',
        hasConcerns: true,
        concernsDetail: 'secret',
        wouldHire: 'no',
        anythingElse: null
      },
      adminReason: 'secret reason',
      voucher: {
        name: 'Vera',
        email: 'vera@example.com',
        firstName: null,
        lastName: null,
        banned: false,
        banExpires: null,
        emailVerified: true,
        hasLiveApproval: true
      }
    };
    const result = await Effect.runPromise(
      listMyVouchesProgram(asSession(applicant)).pipe(
        Effect.provide(makeLayer({ listed: [flagged] }))
      )
    );
    expect(result.vouches[0].status).toBe('not_counted');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).toMatchObject({ counting: 0, recommended: 2 });
  });
});

describe('submitVouchProgram', () => {
  it('accepts with answers, attestation time and IP, only while pending', async () => {
    const transitions: Array<VouchTransition> = [];
    await Effect.runPromise(
      submitVouchProgram(asSession(voucher), dummyVouch.id, answers, '203.0.113.9').pipe(
        Effect.provide(
          makeLayer({
            vouch: { ...dummyVouch, voucherUserId: voucher.id },
            onTransition: (t) => transitions.push(t)
          })
        )
      )
    );
    expect(transitions[0]).toMatchObject({
      from: ['pending'],
      notExpired: true,
      voucherUserId: voucher.id,
      set: { status: 'accepted', submittedIp: '203.0.113.9' }
    });
    expect(transitions[0].set.attestedAt).toBeInstanceOf(Date);
  });

  it("treats someone else's vouch as not found", async () => {
    const exit = await Effect.runPromiseExit(
      submitVouchProgram(asSession(voucher), dummyVouch.id, answers, null).pipe(
        Effect.provide(makeLayer({ vouch: { ...dummyVouch, voucherUserId: 'someone-else' } }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchNotFoundError' });
  });
});

describe('withdrawVouchProgram', () => {
  it('refuses once the applicant is approved', async () => {
    const exit = await Effect.runPromiseExit(
      withdrawVouchProgram(asSession(voucher), dummyVouch.id).pipe(
        Effect.provide(
          makeLayer({ vouch: { ...dummyVouch, voucherUserId: voucher.id, status: 'accepted' } })
        )
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchLockedError' });
  });

  it('revokes an accepted vouch while the applicant is unapproved', async () => {
    const transitions: Array<VouchTransition> = [];
    await Effect.runPromise(
      withdrawVouchProgram(asSession(voucher), dummyVouch.id).pipe(
        Effect.provide(
          makeLayer({
            vouch: { ...dummyVouch, voucherUserId: voucher.id, status: 'accepted' },
            approved: { [dummyVouch.applicantUserId]: false },
            onTransition: (t) => transitions.push(t)
          })
        )
      )
    );
    expect(transitions[0]).toMatchObject({
      from: ['accepted'],
      set: { status: 'revoked', revokedBy: voucher.id }
    });
  });
});

describe('adminVouchActionProgram', () => {
  it('flags a pending or accepted vouch with the admin and reason recorded', async () => {
    const transitions: Array<VouchTransition> = [];
    await Effect.runPromise(
      adminVouchActionProgram(
        'admin-1',
        dummyVouch.id,
        'flagged',
        'Same household as applicant'
      ).pipe(Effect.provide(makeLayer({ onTransition: (t) => transitions.push(t) })))
    );
    expect(transitions[0]).toMatchObject({
      from: ['pending', 'accepted'],
      set: { status: 'flagged', revokedBy: 'admin-1', adminReason: 'Same household as applicant' }
    });
  });

  it('fails with VouchStateError when the vouch already moved', async () => {
    const exit = await Effect.runPromiseExit(
      adminVouchActionProgram('admin-1', dummyVouch.id, 'revoked', 'x').pipe(
        Effect.provide(makeLayer({ transitionResult: null }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchStateError' });
  });
});
