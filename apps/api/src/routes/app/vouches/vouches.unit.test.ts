import { SqlError } from '@effect/sql/SqlError';
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
  type VouchWithApplicant,
  type VouchWithVoucher
} from '@repo/db';
import { makeNotificationHubTest } from '@repo/notify';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { makeMailerTest, type VouchRequestMail } from '@/api/lib/mailer';
import {
  adminVouchActionProgram,
  adminVouchActionRouteProgram,
  declineVouchRouteProgram,
  listMyVouchesProgram,
  listVouchRequestsProgram,
  requestVouchProgram,
  submitVouchProgram,
  submitVouchRouteProgram,
  withdrawVouchProgram,
  withdrawVouchRouteProgram
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
    voucherListed?: Array<VouchWithApplicant>;
    transitionResult?: Vouch | null;
    onCreate?: (input: unknown) => void;
    onTransition?: (input: VouchTransition) => void;
    transitionFailsWith?: SqlError;
    pairHistory?: Array<Vouch>;
    recent?: { pendingOpen: number; createdSince: number };
    onCountSince?: (since: Date) => void;
    /** Called on every vouch-repo read or write, to prove one never happened. */
    onRepoTouch?: () => void;
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
      findById: (id) => {
        options.onRepoTouch?.();
        return options.vouch
          ? Effect.succeed(options.vouch)
          : Effect.fail(new DBNotFoundError({ entity: 'vouch', value: id }));
      },
      findOpenByPair: () => Effect.succeed(options.openPair ?? null),
      listByPair: () => Effect.succeed(options.pairHistory ?? []),
      countRecentByApplicant: (_applicantUserId, since) => {
        options.onCountSince?.(since);
        return Effect.succeed(options.recent ?? { pendingOpen: 0, createdSince: 0 });
      },
      listForApplicants: () => Effect.succeed(options.listed ?? []),
      listForVoucher: () => Effect.succeed(options.voucherListed ?? []),
      transition: (input) => {
        options.onRepoTouch?.();
        options.onTransition?.(input);
        if (options.transitionFailsWith) return Effect.fail(options.transitionFailsWith);
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

  const DAY = 24 * 60 * 60 * 1000;
  const requestWith = (options: Parameters<typeof makeLayer>[0]) =>
    Effect.runPromiseExit(
      requestVouchProgram(
        asSession(applicant),
        { email: voucher.email, relationship: 'X' },
        ctx
      ).pipe(Effect.provide(makeLayer(options)))
    );

  it('refuses re-asking a voucher an admin flagged or revoked, with the vague error', async () => {
    const created: Array<unknown> = [];
    const flagged = await requestWith({
      pairHistory: [{ ...dummyVouch, status: 'flagged', revokedBy: 'admin-1' }],
      onCreate: (i) => created.push(i)
    });
    const revoked = await requestWith({
      pairHistory: [
        { ...dummyVouch, status: 'revoked', revokedBy: 'admin-1', decidedAt: new Date(0) }
      ],
      onCreate: (i) => created.push(i)
    });
    expect(failureOf(flagged)).toMatchObject({ _tag: 'VoucherUnavailableError' });
    expect(failureOf(revoked)).toMatchObject({ _tag: 'VoucherUnavailableError' });
    expect(created).toEqual([]);
  });

  it('refuses re-asking within 14 days of the voucher declining or withdrawing', async () => {
    const recently = new Date(Date.now() - 2 * DAY);
    const declined = await requestWith({
      pairHistory: [{ ...dummyVouch, status: 'declined', decidedAt: recently }]
    });
    const withdrew = await requestWith({
      pairHistory: [
        { ...dummyVouch, status: 'revoked', revokedBy: voucher.id, decidedAt: recently }
      ]
    });
    expect(failureOf(declined)).toMatchObject({ _tag: 'VoucherUnavailableError' });
    expect(failureOf(withdrew)).toMatchObject({ _tag: 'VoucherUnavailableError' });
  });

  it('allows re-asking once 14 days have passed since the voucher declined', async () => {
    const exit = await requestWith({
      pairHistory: [
        { ...dummyVouch, status: 'declined', decidedAt: new Date(Date.now() - 15 * DAY) }
      ]
    });
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it('rate-limits at 5 open requests or 10 created in the last 24 hours', async () => {
    const created: Array<unknown> = [];
    const since: Array<Date> = [];
    const tooManyOpen = await requestWith({
      recent: { pendingOpen: 5, createdSince: 5 },
      onCreate: (i) => created.push(i),
      onCountSince: (d) => since.push(d)
    });
    const tooManyToday = await requestWith({
      recent: { pendingOpen: 0, createdSince: 10 },
      onCreate: (i) => created.push(i)
    });
    expect(failureOf(tooManyOpen)).toMatchObject({ _tag: 'VouchRateLimitedError' });
    expect(failureOf(tooManyToday)).toMatchObject({ _tag: 'VouchRateLimitedError' });
    expect(created).toEqual([]);
    expect(Math.abs(Date.now() - DAY - since[0].getTime())).toBeLessThan(5_000);

    const underLimit = await requestWith({ recent: { pendingOpen: 4, createdSince: 9 } });
    expect(Exit.isSuccess(underLimit)).toBe(true);
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

describe('listVouchRequestsProgram', () => {
  const asVoucherRow = (
    overrides: Partial<Vouch>,
    applicantHasLiveApproval = false
  ): VouchWithApplicant => ({
    ...dummyVouch,
    ...overrides,
    applicant: { name: 'Ana Applicant', firstName: null, lastName: null, image: null },
    applicantHasLiveApproval
  });

  it('offers Withdraw only on an accepted vouch whose applicant is not yet approved', async () => {
    const result = await Effect.runPromise(
      listVouchRequestsProgram(asSession(voucher)).pipe(
        Effect.provide(
          makeLayer({
            voucherListed: [
              asVoucherRow({ id: 'v-accepted-unapproved', status: 'accepted' }, false),
              asVoucherRow({ id: 'v-accepted-approved', status: 'accepted' }, true),
              asVoucherRow({ id: 'v-pending', status: 'pending' }, false),
              asVoucherRow({ id: 'v-flagged', status: 'flagged' }, false),
              asVoucherRow({ id: 'v-declined', status: 'declined' }, false)
            ]
          })
        )
      )
    );
    expect(result.requests.map((request) => [request.id, request.canWithdraw])).toEqual([
      ['v-accepted-unapproved', true],
      ['v-accepted-approved', false],
      ['v-pending', false],
      ['v-flagged', false],
      ['v-declined', false]
    ]);
    // The applicant's approval itself is not exposed to the voucher.
    expect(JSON.stringify(result)).not.toMatch(/applicantHasLiveApproval/);
  });

  it('shows the voucher "closed" for admin flags and revokes, never the admin action', async () => {
    const result = await Effect.runPromise(
      listVouchRequestsProgram(asSession(voucher)).pipe(
        Effect.provide(
          makeLayer({
            voucherListed: [
              asVoucherRow({ id: 'v-1', status: 'flagged', adminReason: 'secret reason' }),
              asVoucherRow({ id: 'v-2', status: 'revoked', revokedBy: 'admin-1' }),
              asVoucherRow({ id: 'v-3', status: 'revoked', revokedBy: voucher.id }),
              asVoucherRow({ id: 'v-4', status: 'accepted' })
            ]
          })
        )
      )
    );
    expect(result.requests.map((request) => [request.id, request.status])).toEqual([
      ['v-1', 'closed'],
      ['v-2', 'closed'],
      ['v-3', 'closed'],
      ['v-4', 'accepted']
    ]);
    expect(JSON.stringify(result)).not.toMatch(/flagged"|revoked"|secret/);
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

  it('maps a lost race on the one-accepted-per-pair index to VouchStateError', async () => {
    const exit = await Effect.runPromiseExit(
      submitVouchProgram(asSession(voucher), dummyVouch.id, answers, null).pipe(
        Effect.provide(
          makeLayer({
            vouch: { ...dummyVouch, voucherUserId: voucher.id },
            transitionFailsWith: new SqlError({
              cause: { code: '23505', constraint: 'vouches_pair_accepted_uidx' }
            })
          })
        )
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchStateError' });
  });

  it('still reports other repo failures as VouchRepoError', async () => {
    const exit = await Effect.runPromiseExit(
      submitVouchProgram(asSession(voucher), dummyVouch.id, answers, null).pipe(
        Effect.provide(
          makeLayer({
            vouch: { ...dummyVouch, voucherUserId: voucher.id },
            transitionFailsWith: new SqlError({ message: 'db down' })
          })
        )
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchRepoError' });
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

describe('vouch route programs: the :id param', () => {
  const contextFor = (id: string, body: unknown = {}) =>
    ({
      req: {
        json: async () => body,
        param: (key: string) => (key === 'id' ? id : undefined),
        header: () => undefined
      }
    }) as unknown as HonoContext<HonoEnv>;

  it('answers a non-UUID id with VouchNotFoundError without touching the vouch repo', async () => {
    let touched = 0;
    const layer = makeLayer({ vouch: dummyVouch, onRepoTouch: () => touched++ });
    const run = <A, E>(program: Effect.Effect<A, E, Layer.Layer.Success<typeof layer>>) =>
      Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
    const exits: Array<Exit.Exit<unknown, { _tag: string }>> = [
      await run(submitVouchRouteProgram(contextFor('not-a-uuid', answers), new Headers())),
      await run(declineVouchRouteProgram(contextFor('not-a-uuid'), new Headers())),
      await run(withdrawVouchRouteProgram(contextFor("1' OR 1=1"), new Headers())),
      await run(
        adminVouchActionRouteProgram(
          contextFor('vouch-1', { reason: 'x' }),
          new Headers(),
          'flagged'
        )
      ),
      await run(
        adminVouchActionRouteProgram(contextFor('', { reason: 'x' }), new Headers(), 'revoked')
      )
    ];
    for (const exit of exits) {
      expect(failureOf(exit)).toMatchObject({ _tag: 'VouchNotFoundError' });
    }
    expect(touched).toBe(0);
  });

  it('passes a UUID id through to the repo', async () => {
    let touched = 0;
    const exit = await Effect.runPromiseExit(
      declineVouchRouteProgram(
        contextFor('01928f3e-7b6a-7c1d-9e2f-0123456789ab'),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ onRepoTouch: () => touched++ })))
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchNotFoundError' });
    expect(touched).toBe(1);
  });
});
