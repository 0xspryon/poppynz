import {
  makeCredibledTest,
  type CredibledCheckTypeValue
} from '@repo/credibled';
import {
  DBNotFoundError,
  makeKycDocumentTypeRepoTest,
  makeSafetyVerificationRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type KycDocumentType,
  type SafetyVerification,
  type SafetyVerificationCreateInput,
  type SafetyVerificationItem,
  type SafetyVerificationItemCreateInput,
  type SafetyVerificationUpdateInput,
  type Session,
  type User
} from '@repo/db';
import { makePaymentsTest } from '@repo/payments';
import { makeSafetyVerificationQueueTest } from '@repo/queue';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  addSafetyVerificationItemRouteProgram,
  decideSafetyVerificationRouteProgram,
  orderSafetyCheckRouteProgram,
  submitSafetyDocumentRouteProgram
} from './safety-verification.handler';

const user = (overrides: Partial<User> = {}): User =>
  ({
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
  }) as User;

const session = (userId: string): Session =>
  ({
    id: 'session-1',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    token: 'session-token',
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:00.000Z'),
    ipAddress: null,
    userAgent: null,
    userId,
    impersonatedBy: null,
    activeOrganizationId: null
  }) as Session;

const documentType = (overrides: Partial<KycDocumentType> = {}): KycDocumentType =>
  ({
    id: 'type-1',
    name: 'Enhanced Canadian Criminal Record Check',
    appliesToRole: 'service-provider',
    isOptional: true,
    requiresExpiryDate: false,
    credibledCheckTypeValue: 'request_enhanced_criminal_record_check',
    credibledCostCents: 4500,
    backsSafetyVerification: false,
    deletedAt: null,
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:00.000Z'),
    ...overrides
  }) as KycDocumentType;

const verification = (overrides: Partial<SafetyVerification> = {}): SafetyVerification =>
  ({
    id: 'sv-1',
    userId: 'provider-1',
    role: 'service-provider',
    status: 'review_required',
    route: 'uploaded_document',
    credibledCheckUuid: null,
    consentAt: new Date('2026-08-01T00:00:00.000Z'),
    consentPolicyVersion: '2026-08-22',
    paymentReference: null,
    refundReference: null,
    amountCents: null,
    feeCents: null,
    taxCents: null,
    totalCents: null,
    issuingAuthority: 'Toronto Police Service',
    documentNumber: 'VSC-1234',
    filename: 'vsc.pdf',
    fileKey: 'users/provider-1/vsc.pdf',
    issuedOn: '2026-01-01',
    expiresOn: '2027-01-01',
    reviewedBy: null,
    reviewedAt: null,
    decisionReason: null,
    expiryNotifiedAt: null,
    orderAttempts: 0,
    lastOrderError: null,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as SafetyVerification;

const item = (overrides: Partial<SafetyVerificationItem> = {}): SafetyVerificationItem =>
  ({
    id: 'item-1',
    verificationId: 'sv-1',
    documentTypeId: 'type-1',
    credibledCheckTypeValue: 'request_enhanced_criminal_record_check',
    costCents: 4500,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as SafetyVerificationItem;

const contextWithJson = (body: unknown) =>
  ({ req: { json: () => Promise.resolve(body) } }) as unknown as HonoContext<HonoEnv>;

const makeLayer = (
  options: {
    user?: User;
    hasPermission?: boolean;
    live?: SafetyVerification | null;
    byId?: SafetyVerification | null;
    types?: Array<KycDocumentType>;
    credibledConfigured?: boolean;
    items?: Array<SafetyVerificationItem>;
    onCreate?: (input: SafetyVerificationCreateInput) => void;
    onUpdate?: (id: string, input: SafetyVerificationUpdateInput) => void;
    onAddItem?: (input: SafetyVerificationItemCreateInput) => void;
    onEnqueue?: (verificationId: string) => void;
  } = {}
) => {
  const currentUser = options.user ?? user();
  const currentSession = session(currentUser.id);

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
      findById: () => Effect.succeed(currentSession)
    }),
    makeKycDocumentTypeRepoTest({
      listActive: () => Effect.succeed(options.types ?? [documentType()]),
      findActiveById: () => Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: '' })),
      create: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' }) as never),
      update: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' })),
      softDelete: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' }))
    }),
    makeSafetyVerificationRepoTest({
      findLive: () => Effect.succeed(options.live ?? null),
      findById: () =>
        options.byId
          ? Effect.succeed(options.byId)
          : Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: '' })),
      findByCredibledUuid: () => Effect.succeed(null),
      listByUser: () => Effect.succeed([]),
      listForReview: () => Effect.succeed([]),
      create: (input) => {
        options.onCreate?.(input);
        return Effect.succeed(verification({ ...input } as Partial<SafetyVerification>));
      },
      update: (id, input) => {
        options.onUpdate?.(id, input);
        return Effect.succeed(
          verification({ ...(options.byId ?? {}), ...input } as Partial<SafetyVerification>)
        );
      },
      listExpiringForNotification: () => Effect.succeed([]),
      markExpiryNotified: () =>
        Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: '' })),
      listLapsed: () => Effect.succeed([]),
      listInFlight: () => Effect.succeed([]),
      listAwaitingOrder: () => Effect.succeed([]),
      listItems: () => Effect.succeed(options.items ?? []),
      addItem: (input) => {
        options.onAddItem?.(input);
        return Effect.succeed(item({ ...input } as Partial<SafetyVerificationItem>));
      },
      removeItem: () => Effect.succeed(item())
    }),
    makePaymentsTest({}),
    makeCredibledTest({
      isConfigured: () => options.credibledConfigured ?? true
    }),
    makeSafetyVerificationQueueTest({
      enqueueOrder: ({ verificationId }) => {
        options.onEnqueue?.(verificationId);
        return Effect.succeed({ id: 'job-1', name: 'place-order' });
      }
    })
  );
};

const failureTag = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const failure = Cause.failureOption(exit.cause);
  return Option.isSome(failure) ? (failure.value as { _tag: string })._tag : null;
};

const futureDate = '2099-01-01';

describe('submitting an existing document', () => {
  it('creates a record awaiting review — never a verified one', async () => {
    const created: Array<SafetyVerificationCreateInput> = [];
    const result = await Effect.runPromise(
      submitSafetyDocumentRouteProgram(
        contextWithJson({
          consentAccepted: true,
          issuingAuthority: 'Toronto Police Service',
          documentNumber: 'VSC-1234',
          filename: 'vsc.pdf',
          fileKey: 'users/provider-1/vsc.pdf',
          issuedOn: '2026-01-01',
          expiresOn: futureDate
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ onCreate: (input) => created.push(input) })))
    );

    expect(created[0]?.status).toBe('review_required');
    expect(created[0]?.route).toBe('uploaded_document');
    expect(result.verification.status).not.toBe('verified');
  });

  it('stamps consent server-side rather than trusting the client', async () => {
    const created: Array<SafetyVerificationCreateInput> = [];
    await Effect.runPromise(
      submitSafetyDocumentRouteProgram(
        contextWithJson({
          consentAccepted: true,
          issuingAuthority: 'RCMP',
          documentNumber: 'X1',
          filename: 'a.pdf',
          fileKey: 'users/provider-1/a.pdf',
          issuedOn: '2026-01-01',
          expiresOn: futureDate,
          // A client-supplied policy version must be ignored.
          consentPolicyVersion: 'attacker-supplied'
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ onCreate: (input) => created.push(input) })))
    );

    expect(created[0]?.consentAt).toBeInstanceOf(Date);
    expect(created[0]?.consentPolicyVersion).not.toBe('attacker-supplied');
  });

  it("refuses a file key belonging to somebody else", async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(
        contextWithJson({
          consentAccepted: true,
          issuingAuthority: 'RCMP',
          documentNumber: 'X1',
          filename: 'a.pdf',
          // Another applicant's upload prefix.
          fileKey: 'users/victim-9/their-vsc.pdf',
          issuedOn: '2026-01-01',
          expiresOn: futureDate
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer()))
    );

    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses a document that has already expired', async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(
        contextWithJson({
          consentAccepted: true,
          issuingAuthority: 'RCMP',
          documentNumber: 'X1',
          filename: 'a.pdf',
          fileKey: 'users/provider-1/a.pdf',
          issuedOn: '2020-01-01',
          expiresOn: '2021-01-01'
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer()))
    );

    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('requires consent', async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(
        contextWithJson({
          consentAccepted: false,
          issuingAuthority: 'RCMP',
          documentNumber: 'X1',
          filename: 'a.pdf',
          fileKey: 'users/provider-1/a.pdf',
          issuedOn: '2026-01-01',
          expiresOn: futureDate
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer()))
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('reuses an abandoned Credibled basket instead of inserting a second row', async () => {
    // The partial unique index allows one live record per (user, role), so
    // inserting alongside a `not_started` basket would 500. Upload must take
    // the existing row over.
    const created: Array<SafetyVerificationCreateInput> = [];
    const updates: Array<SafetyVerificationUpdateInput> = [];
    await Effect.runPromise(
      submitSafetyDocumentRouteProgram(
        contextWithJson({
          consentAccepted: true,
          issuingAuthority: 'RCMP',
          documentNumber: 'X1',
          filename: 'a.pdf',
          fileKey: 'users/provider-1/a.pdf',
          issuedOn: '2026-01-01',
          expiresOn: futureDate
        }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            live: verification({ status: 'not_started', route: 'credibled' }),
            // Abandoned means EMPTY — a basket with items is live, see below.
            items: [],
            onCreate: (input) => created.push(input),
            onUpdate: (_id, input) => updates.push(input)
          })
        )
      )
    );

    expect(created).toHaveLength(0);
    expect(updates[0]?.status).toBe('review_required');
    expect(updates[0]?.route).toBe('uploaded_document');
  });

  it('refuses to discard a Credibled list the applicant is still building', async () => {
    // Reusing the row would silently drop queued checks. Losing somebody's
    // selection without telling them is the one unrecoverable outcome.
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(
        contextWithJson({
          consentAccepted: true,
          issuingAuthority: 'RCMP',
          documentNumber: 'X1',
          filename: 'a.pdf',
          fileKey: 'users/provider-1/a.pdf',
          issuedOn: '2026-01-01',
          expiresOn: futureDate
        }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({ live: verification({ status: 'not_started' }), items: [item()] })
        )
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('refuses while another verification is already live', async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(
        contextWithJson({
          consentAccepted: true,
          issuingAuthority: 'RCMP',
          documentNumber: 'X1',
          filename: 'a.pdf',
          fileKey: 'users/provider-1/a.pdf',
          issuedOn: '2026-01-01',
          expiresOn: futureDate
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ live: verification({ status: 'in_progress' }) })))
    );

    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('denies an applicant without the write permission', async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(
        contextWithJson({
          consentAccepted: true,
          issuingAuthority: 'RCMP',
          documentNumber: 'X1',
          filename: 'a.pdf',
          fileKey: 'users/provider-1/a.pdf',
          issuedOn: '2026-01-01',
          expiresOn: futureDate
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ hasPermission: false })))
    );

    expect(failureTag(exit)).toBe('ForbiddenError');
  });

  it('refuses to screen an admin', async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(
        contextWithJson({
          consentAccepted: true,
          issuingAuthority: 'RCMP',
          documentNumber: 'X1',
          filename: 'a.pdf',
          fileKey: 'users/admin-1/a.pdf',
          issuedOn: '2026-01-01',
          expiresOn: futureDate
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ user: user({ id: 'admin-1', role: 'admin' }) })))
    );

    expect(failureTag(exit)).toBe('SafetyVerificationRoleError');
  });
});

describe('building the check list', () => {
  it('creates the basket on the first add and freezes the price', async () => {
    const added: Array<SafetyVerificationItemCreateInput> = [];
    const created: Array<SafetyVerificationCreateInput> = [];
    await Effect.runPromise(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1' }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            live: null,
            onCreate: (input) => created.push(input),
            onAddItem: (input) => added.push(input)
          })
        )
      )
    );

    // The basket is a `not_started` verification, not a separate cart.
    expect(created[0]?.status).toBe('not_started');
    expect(added[0]?.credibledCheckTypeValue).toBe('request_enhanced_criminal_record_check');
    // Frozen from the document type, never sent by the client.
    expect(added[0]?.costCents).toBe(4500);
  });

  it('ignores a client-supplied price', async () => {
    const added: Array<SafetyVerificationItemCreateInput> = [];
    await Effect.runPromise(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1', costCents: 1 }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ live: null, onAddItem: (input) => added.push(input) })))
    );
    expect(added[0]?.costCents).toBe(4500);
  });

  it('refuses a document type that is not fetchable', async () => {
    const exit = await Effect.runPromiseExit(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1' }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({ types: [documentType({ credibledCheckTypeValue: null })], live: null })
        )
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses a fetchable type with no price configured', async () => {
    const exit = await Effect.runPromiseExit(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1' }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({ types: [documentType({ credibledCostCents: null })], live: null })
        )
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses the same check twice', async () => {
    const exit = await Effect.runPromiseExit(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1' }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({ live: verification({ status: 'not_started' }), items: [item()] })
        )
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('refuses two checks from the same Credibled club', async () => {
    // Credibled fulfils only the highest tier when two members of one club are
    // requested together — adding both bills twice and delivers once.
    const exit = await Effect.runPromiseExit(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-2' }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            types: [
              documentType(),
              documentType({
                id: 'type-2',
                name: 'Canadian Criminal Record Check',
                // Same club (ca_crim_check) as the enhanced tier already added.
                credibledCheckTypeValue: 'request_criminal_record_check',
                credibledCostCents: 3500
              })
            ],
            live: verification({ status: 'not_started' }),
            items: [item()]
          })
        )
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('allows a check from a different club', async () => {
    const added: Array<SafetyVerificationItemCreateInput> = [];
    await Effect.runPromise(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-2' }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            types: [
              documentType(),
              documentType({
                id: 'type-2',
                name: "Driver's Abstract",
                credibledCheckTypeValue: 'request_motor_vehicle_records',
                credibledCostCents: 2500
              })
            ],
            live: verification({ status: 'not_started' }),
            items: [item()],
            onAddItem: (input) => added.push(input)
          })
        )
      )
    );
    expect(added[0]?.credibledCheckTypeValue).toBe('request_motor_vehicle_records');
  });

  it('refuses to change the list once a check is under way', async () => {
    const exit = await Effect.runPromiseExit(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1' }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ live: verification({ status: 'invited' }) })))
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });
});

describe('ordering a check', () => {
  const basketReady = {
    live: verification({ status: 'not_started' }),
    items: [item(), item({ id: 'item-2', credibledCheckTypeValue: 'request_motor_vehicle_records', costCents: 2500 })]
  };

  it('charges the summed basket once and hands the order to the worker', async () => {
    const enqueued: Array<string> = [];
    const updates: Array<SafetyVerificationUpdateInput> = [];
    await Effect.runPromise(
      orderSafetyCheckRouteProgram(
        contextWithJson({ consentAccepted: true }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            ...basketReady,
            onEnqueue: (id) => enqueued.push(id),
            onUpdate: (_id, input) => updates.push(input)
          })
        )
      )
    );

    expect(enqueued).toHaveLength(1);
    expect(updates[0]?.status).toBe('payment_pending');
    expect(updates[0]?.paymentReference).toBeTruthy();
    // 4500 + 2500 checks, + 500 fee, 0 tax.
    expect(updates[0]?.amountCents).toBe(7000);
    expect(updates[0]?.feeCents).toBe(500);
    expect(updates[0]?.totalCents).toBe(7500);
  });

  it('refuses to charge for an empty basket', async () => {
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(
        contextWithJson({ consentAccepted: true }),
        new Headers()
      ).pipe(
        Effect.provide(makeLayer({ live: verification({ status: 'not_started' }), items: [] }))
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses when nothing has been selected at all', async () => {
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(
        contextWithJson({ consentAccepted: true }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ live: null })))
    );
    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses a second order while one is in progress', async () => {
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(
        contextWithJson({ consentAccepted: true }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ live: verification({ status: 'invited' }) })))
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('requires consent', async () => {
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(
        contextWithJson({ consentAccepted: false }),
        new Headers()
      ).pipe(Effect.provide(makeLayer(basketReady)))
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe('admin decisions', () => {
  const admin = user({ id: 'admin-1', role: 'admin' });

  it('approves and sets an expiry', async () => {
    const updates: Array<SafetyVerificationUpdateInput> = [];
    await Effect.runPromise(
      decideSafetyVerificationRouteProgram(
        contextWithJson({ decision: 'approve' }),
        new Headers(),
        'sv-1'
      ).pipe(
        Effect.provide(
          makeLayer({
            user: admin,
            byId: verification(),
            onUpdate: (_id, input) => updates.push(input)
          })
        )
      )
    );

    expect(updates[0]?.status).toBe('verified');
    expect(updates[0]?.reviewedBy).toBe('admin-1');
    expect(updates[0]?.expiresOn).toBeTruthy();
  });

  it('refuses a rejection with no reason — the applicant sees it', async () => {
    const exit = await Effect.runPromiseExit(
      decideSafetyVerificationRouteProgram(
        contextWithJson({ decision: 'reject', reason: '   ' }),
        new Headers(),
        'sv-1'
      ).pipe(Effect.provide(makeLayer({ user: admin, byId: verification() })))
    );

    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses to decide a record that is not awaiting a decision', async () => {
    // Guards against a replayed request re-approving a rejected record or
    // overwriting a decision somebody else already made.
    const exit = await Effect.runPromiseExit(
      decideSafetyVerificationRouteProgram(
        contextWithJson({ decision: 'approve' }),
        new Headers(),
        'sv-1'
      ).pipe(
        Effect.provide(makeLayer({ user: admin, byId: verification({ status: 'rejected' }) }))
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('refuses to approve with an expiry already in the past', async () => {
    const exit = await Effect.runPromiseExit(
      decideSafetyVerificationRouteProgram(
        contextWithJson({ decision: 'approve', expiresOn: '2020-01-01' }),
        new Headers(),
        'sv-1'
      ).pipe(Effect.provide(makeLayer({ user: admin, byId: verification() })))
    );

    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('denies an applicant trying to approve their own verification', async () => {
    const exit = await Effect.runPromiseExit(
      decideSafetyVerificationRouteProgram(
        contextWithJson({ decision: 'approve' }),
        new Headers(),
        'sv-1'
      ).pipe(
        Effect.provide(
          // A provider has safetyVerification read+write but never `review`.
          makeLayer({ hasPermission: false, byId: verification() })
        )
      )
    );

    expect(failureTag(exit)).toBe('ForbiddenError');
  });

  it('rejects a check type outside the catalogue at the type level', () => {
    const value: CredibledCheckTypeValue = 'request_enhanced_criminal_record_check';
    expect(value).toBe('request_enhanced_criminal_record_check');
  });
});
