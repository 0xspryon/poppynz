import { makeCredibledTest, type CredibledCheckTypeValue } from '@repo/credibled';
import {
  DBNotFoundError,
  makeCheckOrderRepoTest,
  makeKycDocumentTypeRepoTest,
  makePaymentRepoTest,
  makeSafetyVerificationRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type CheckOrder,
  type CheckOrderAdvanceInput,
  type CheckOrderClaimInput,
  type CheckOrderCreateInput,
  type CheckOrderItem,
  type CheckOrderItemCreateInput,
  type CheckOrderUpdateInput,
  type KycDocumentType,
  type Payment,
  type PaymentCreateInput,
  type PaymentUpdateInput,
  type SafetyVerification,
  type SafetyVerificationCreateInput,
  type SafetyVerificationUpdateInput,
  type Session,
  type User
} from '@repo/db';
import { makeMockPayments, makePaymentsTest, PaymentDeclinedError } from '@repo/payments';
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
    isSafetyGate: false,
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
    checkOrderId: null,
    consentAt: new Date('2026-08-01T00:00:00.000Z'),
    consentPolicyVersion: '2026-08-22',
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
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as SafetyVerification;

const order = (overrides: Partial<CheckOrder> = {}): CheckOrder =>
  ({
    id: 'order-1',
    userId: 'provider-1',
    role: 'service-provider',
    status: 'draft',
    paymentId: null,
    credibledCheckUuid: null,
    applicationUrl: null,
    consentAt: null,
    consentPolicyVersion: '2026-08-22',
    orderAttempts: 0,
    lastOrderError: null,
    completedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as CheckOrder;

const item = (overrides: Partial<CheckOrderItem> = {}): CheckOrderItem =>
  ({
    id: 'item-1',
    orderId: 'order-1',
    documentTypeId: 'type-1',
    credibledCheckTypeValue: 'request_enhanced_criminal_record_check',
    costCents: 4500,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as CheckOrderItem;

const payment = (overrides: Partial<Payment> = {}): Payment =>
  ({
    id: 'payment-1',
    userId: 'provider-1',
    kind: 'credibled_order',
    status: 'pending',
    provider: 'mock',
    providerReference: null,
    refundReference: null,
    amountCents: 0,
    feeCents: 0,
    taxCents: 0,
    totalCents: 0,
    currency: 'CAD',
    lastError: null,
    authorisedAt: null,
    capturedAt: null,
    refundedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as Payment;

const contextWithJson = (body: unknown) =>
  ({ req: { json: () => Promise.resolve(body) } }) as unknown as HonoContext<HonoEnv>;

type Recorded = {
  verificationsCreated: Array<SafetyVerificationCreateInput>;
  verificationUpdates: Array<SafetyVerificationUpdateInput>;
  ordersCreated: Array<CheckOrderCreateInput>;
  orderUpdates: Array<CheckOrderUpdateInput>;
  claims: Array<CheckOrderClaimInput>;
  advances: Array<CheckOrderAdvanceInput>;
  /** Idempotency keys handed to the provider — one per charge attempt. */
  authorised: Array<string>;
  itemsAdded: Array<CheckOrderItemCreateInput>;
  paymentsCreated: Array<PaymentCreateInput>;
  paymentUpdates: Array<PaymentUpdateInput>;
  enqueued: Array<string>;
};

const record = (): Recorded => ({
  verificationsCreated: [],
  verificationUpdates: [],
  ordersCreated: [],
  orderUpdates: [],
  claims: [],
  advances: [],
  authorised: [],
  itemsAdded: [],
  paymentsCreated: [],
  paymentUpdates: [],
  enqueued: []
});

const makeLayer = (
  options: {
    user?: User;
    hasPermission?: boolean;
    /** The live verdict, if any. */
    live?: SafetyVerification | null;
    byId?: SafetyVerification | null;
    /** The open order, if any. */
    openOrder?: CheckOrder | null;
    items?: Array<CheckOrderItem>;
    /** What the order's current payment looks like — for the resume path. */
    paymentById?: Payment | null;
    types?: Array<KycDocumentType>;
    credibledConfigured?: boolean;
    /** The compare-and-set claim finds the order already taken. */
    claimLost?: boolean;
    /** A guarded transition finds the order already moved. */
    advanceLost?: boolean;
    declineCharge?: boolean;
    recorded?: Recorded;
  } = {}
) => {
  const currentUser = options.user ?? user();
  const currentSession = session(currentUser.id);
  const recorded = options.recorded ?? record();
  const openOrder = options.openOrder ?? null;
  // The payment row this request creates, so a later update sees the frozen
  // amounts the way the real repository would.
  let current: Payment | null = null;
  const mockPayments = makeMockPayments();

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
      listByUser: () => Effect.succeed([]),
      listForReview: () => Effect.succeed([]),
      create: (input) => {
        recorded.verificationsCreated.push(input);
        return Effect.succeed(verification({ ...input } as Partial<SafetyVerification>));
      },
      update: (_id, input) => {
        recorded.verificationUpdates.push(input);
        return Effect.succeed(
          verification({ ...(options.byId ?? {}), ...input } as Partial<SafetyVerification>)
        );
      },
      listExpiringForNotification: () => Effect.succeed([]),
      markExpiryNotified: () =>
        Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: '' })),
      listLapsed: () => Effect.succeed([])
    }),
    makeCheckOrderRepoTest({
      findById: (id) =>
        openOrder && openOrder.id === id
          ? Effect.succeed(openOrder)
          : Effect.fail(new DBNotFoundError({ entity: 'checkOrder', value: id })),
      findOpen: () => Effect.succeed(openOrder),
      findByCredibledUuid: () => Effect.succeed(null),
      create: (input) => {
        recorded.ordersCreated.push(input);
        return Effect.succeed(order({ ...input } as Partial<CheckOrder>));
      },
      update: (_id, input) => {
        recorded.orderUpdates.push(input);
        return Effect.succeed(order({ ...(openOrder ?? {}), ...input } as Partial<CheckOrder>));
      },
      claimForPayment: (_id, input) => {
        recorded.claims.push(input);
        return Effect.succeed(
          options.claimLost
            ? null
            : order({
                ...(openOrder ?? {}),
                status: 'payment_pending',
                paymentId: input.paymentId
              } as Partial<CheckOrder>)
        );
      },
      advance: (_id, input) => {
        recorded.advances.push(input);
        return Effect.succeed(
          options.advanceLost
            ? null
            : order({ ...(openOrder ?? {}), ...input.set } as Partial<CheckOrder>)
        );
      },
      complete: () => Effect.succeed(null),
      listInFlight: () => Effect.succeed([]),
      listAwaitingPlacement: () => Effect.succeed([]),
      listItems: () => Effect.succeed(options.items ?? []),
      addItem: (input) => {
        recorded.itemsAdded.push(input);
        return Effect.succeed(item({ ...input } as Partial<CheckOrderItem>));
      },
      removeItem: () => Effect.succeed(item())
    }),
    makePaymentRepoTest({
      findById: (id) =>
        options.paymentById && options.paymentById.id === id
          ? Effect.succeed(options.paymentById)
          : Effect.fail(new DBNotFoundError({ entity: 'payment', value: id })),
      create: (input) => {
        recorded.paymentsCreated.push(input);
        current = payment({ ...input } as Partial<Payment>);
        return Effect.succeed(current);
      },
      update: (_id, input) => {
        recorded.paymentUpdates.push(input);
        current = payment({ ...(current ?? {}), ...input } as Partial<Payment>);
        return Effect.succeed(current);
      }
    }),
    makePaymentsTest({
      authorise: (input) => {
        recorded.authorised.push(input.idempotencyKey);
        return options.declineCharge
          ? Effect.fail(new PaymentDeclinedError({ reason: 'card declined' }))
          : mockPayments.authorise(input);
      }
    }),
    makeCredibledTest({
      isConfigured: () => options.credibledConfigured ?? true
    }),
    makeSafetyVerificationQueueTest({
      enqueueOrder: ({ orderId }) => {
        recorded.enqueued.push(orderId);
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

const documentBody = (overrides: Record<string, unknown> = {}) => ({
  consentAccepted: true,
  issuingAuthority: 'RCMP',
  documentNumber: 'X1',
  filename: 'a.pdf',
  fileKey: 'users/provider-1/a.pdf',
  issuedOn: '2026-01-01',
  expiresOn: futureDate,
  ...overrides
});

describe('submitting an existing document', () => {
  it('creates a verdict awaiting review — never a verified one', async () => {
    const recorded = record();
    const result = await Effect.runPromise(
      submitSafetyDocumentRouteProgram(
        contextWithJson(
          documentBody({
            issuingAuthority: 'Toronto Police Service',
            documentNumber: 'VSC-1234',
            filename: 'vsc.pdf',
            fileKey: 'users/provider-1/vsc.pdf'
          })
        ),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ recorded })))
    );

    expect(recorded.verificationsCreated[0]?.status).toBe('review_required');
    expect(recorded.verificationsCreated[0]?.route).toBe('uploaded_document');
    expect(recorded.verificationsCreated[0]?.checkOrderId).toBeUndefined();
    expect(result.verification.status).not.toBe('verified');
  });

  it('stamps consent server-side rather than trusting the client', async () => {
    const recorded = record();
    await Effect.runPromise(
      submitSafetyDocumentRouteProgram(
        // A client-supplied policy version must be ignored.
        contextWithJson(documentBody({ consentPolicyVersion: 'attacker-supplied' })),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ recorded })))
    );

    expect(recorded.verificationsCreated[0]?.consentAt).toBeInstanceOf(Date);
    expect(recorded.verificationsCreated[0]?.consentPolicyVersion).not.toBe('attacker-supplied');
  });

  it('refuses a file key belonging to somebody else', async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(
        // Another applicant's upload prefix.
        contextWithJson(documentBody({ fileKey: 'users/victim-9/their-vsc.pdf' })),
        new Headers()
      ).pipe(Effect.provide(makeLayer()))
    );

    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses a document that has already expired', async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(
        contextWithJson(documentBody({ issuedOn: '2020-01-01', expiresOn: '2021-01-01' })),
        new Headers()
      ).pipe(Effect.provide(makeLayer()))
    );

    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('requires consent', async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(
        contextWithJson(documentBody({ consentAccepted: false })),
        new Headers()
      ).pipe(Effect.provide(makeLayer()))
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('leaves an empty Credibled draft alone and creates the verdict beside it', async () => {
    // An abandoned basket is inert now that the basket and the verdict are
    // different rows — nothing to reuse, nothing to clean up.
    const recorded = record();
    await Effect.runPromise(
      submitSafetyDocumentRouteProgram(contextWithJson(documentBody()), new Headers()).pipe(
        Effect.provide(makeLayer({ openOrder: order({ status: 'draft' }), items: [], recorded }))
      )
    );

    expect(recorded.verificationsCreated).toHaveLength(1);
    expect(recorded.orderUpdates).toHaveLength(0);
  });

  it('refuses to strand a Credibled list the applicant is still building', async () => {
    // Proceeding would leave queued checks behind. Losing somebody's
    // selection without telling them is the one unrecoverable outcome.
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(contextWithJson(documentBody()), new Headers()).pipe(
        Effect.provide(makeLayer({ openOrder: order({ status: 'draft' }), items: [item()] }))
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('refuses while a verdict is already live', async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(contextWithJson(documentBody()), new Headers()).pipe(
        Effect.provide(makeLayer({ live: verification({ status: 'review_required' }) }))
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('refuses while a Credibled order is in flight', async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(contextWithJson(documentBody()), new Headers()).pipe(
        Effect.provide(makeLayer({ openOrder: order({ status: 'in_progress' }) }))
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('denies an applicant without the write permission', async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(contextWithJson(documentBody()), new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false }))
      )
    );

    expect(failureTag(exit)).toBe('ForbiddenError');
  });

  it('refuses to screen an admin', async () => {
    const exit = await Effect.runPromiseExit(
      submitSafetyDocumentRouteProgram(
        contextWithJson(documentBody({ fileKey: 'users/admin-1/a.pdf' })),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ user: user({ id: 'admin-1', role: 'admin' }) })))
    );

    expect(failureTag(exit)).toBe('SafetyVerificationRoleError');
  });
});

describe('building the check list', () => {
  it('creates a draft order on the first add and freezes the price', async () => {
    const recorded = record();
    await Effect.runPromise(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1' }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ recorded })))
    );

    // The basket is a draft ORDER — no verdict exists until there is evidence.
    expect(recorded.ordersCreated[0]?.status).toBe('draft');
    expect(recorded.verificationsCreated).toHaveLength(0);
    expect(recorded.itemsAdded[0]?.credibledCheckTypeValue).toBe(
      'request_enhanced_criminal_record_check'
    );
    // Frozen from the document type, never sent by the client.
    expect(recorded.itemsAdded[0]?.costCents).toBe(4500);
  });

  it('ignores a client-supplied price', async () => {
    const recorded = record();
    await Effect.runPromise(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1', costCents: 1 }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ recorded })))
    );
    expect(recorded.itemsAdded[0]?.costCents).toBe(4500);
  });

  it('refuses a document type that is not fetchable', async () => {
    const exit = await Effect.runPromiseExit(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1' }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ types: [documentType({ credibledCheckTypeValue: null })] })))
    );
    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses a fetchable type with no price configured', async () => {
    const exit = await Effect.runPromiseExit(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1' }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ types: [documentType({ credibledCostCents: null })] })))
    );
    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses the same check twice', async () => {
    const exit = await Effect.runPromiseExit(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1' }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ openOrder: order(), items: [item()] })))
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
            openOrder: order(),
            items: [item()]
          })
        )
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('allows a check from a different club', async () => {
    const recorded = record();
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
            openOrder: order(),
            items: [item()],
            recorded
          })
        )
      )
    );
    expect(recorded.itemsAdded[0]?.credibledCheckTypeValue).toBe('request_motor_vehicle_records');
  });

  it('refuses to change the list once a check is under way', async () => {
    const exit = await Effect.runPromiseExit(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1' }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ openOrder: order({ status: 'invited' }) })))
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('refuses to start a list while a verdict is live', async () => {
    // A verified applicant has nothing to order; a submitted one must wait.
    const exit = await Effect.runPromiseExit(
      addSafetyVerificationItemRouteProgram(
        contextWithJson({ documentTypeId: 'type-1' }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ live: verification({ status: 'verified' }) })))
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });
});

describe('ordering a check', () => {
  const basketReady = {
    openOrder: order(),
    items: [
      item(),
      item({ id: 'item-2', credibledCheckTypeValue: 'request_motor_vehicle_records', costCents: 2500 })
    ]
  };

  it('charges the summed basket once and hands the order to the worker', async () => {
    const recorded = record();
    const result = await Effect.runPromise(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ ...basketReady, recorded }))
      )
    );

    // A payment row exists before the provider is asked, frozen at the quote:
    // 4500 + 2500 checks, + 500 fee, 0 tax.
    expect(recorded.paymentsCreated).toHaveLength(1);
    expect(recorded.paymentsCreated[0]).toMatchObject({
      kind: 'credibled_order',
      provider: 'mock',
      amountCents: 7000,
      feeCents: 500,
      totalCents: 7500
    });
    // The order is claimed for that payment, then the charge is made and
    // recorded against the same row.
    expect(recorded.claims[0]?.paymentId).toBe('payment-1');
    expect(recorded.paymentUpdates[0]?.status).toBe('authorised');
    expect(recorded.paymentUpdates[0]?.providerReference).toBeTruthy();
    // Marked paid only if still claimed for THIS payment.
    expect(recorded.advances[0]).toMatchObject({
      from: { status: 'payment_pending', paymentId: 'payment-1' },
      set: { status: 'paid' }
    });
    expect(recorded.enqueued).toEqual(['order-1']);
    // No verdict yet — that comes when Credibled finishes.
    expect(recorded.verificationsCreated).toHaveLength(0);
    expect(result.verification.status).toBe('payment_pending');
    expect(result.verification.cost?.totalCents).toBe(7500);
  });

  it('uses the payment row as the idempotency key', async () => {
    const recorded = record();
    await Effect.runPromise(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ ...basketReady, recorded }))
      )
    );
    // The mock derives its reference from the key it was given.
    expect(recorded.paymentUpdates[0]?.providerReference).toBe('mock_auth_payment-1');
  });

  it('releases the order and records the failure when the charge is declined', async () => {
    const recorded = record();
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ ...basketReady, declineCharge: true, recorded }))
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationPaymentError');
    expect(recorded.paymentUpdates[0]).toMatchObject({ status: 'failed', lastError: 'card declined' });
    // Back to a draft the applicant can retry with a fresh charge — but only
    // if the order is still claimed for this payment, so the revert can never
    // clobber a re-claim that got in first.
    expect(recorded.advances[0]).toMatchObject({
      from: { status: 'payment_pending', paymentId: 'payment-1' },
      set: { status: 'draft', paymentId: null }
    });
    expect(recorded.enqueued).toHaveLength(0);
  });

  it('never charges twice when two requests race for the same draft', async () => {
    // The compare-and-set claim is the guard: the loser's payment row never
    // reaches the provider.
    const recorded = record();
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ ...basketReady, claimLost: true, recorded }))
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
    expect(recorded.paymentUpdates[0]?.status).toBe('failed');
    expect(recorded.authorised).toHaveLength(0);
    expect(recorded.enqueued).toHaveLength(0);
  });

  it('flags a settled charge whose order moved before it could be marked paid', async () => {
    // Money was taken; the order is no longer ours. Never silent.
    const recorded = record();
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ ...basketReady, advanceLost: true, recorded }))
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
    expect(recorded.paymentUpdates.at(-1)?.lastError).toMatch(/manual settlement/);
    expect(recorded.enqueued).toHaveLength(0);
  });

  it('finishes an order whose charge already landed instead of charging again', async () => {
    // The follow-up write after a successful authorise failed last time. The
    // money is taken; the only correct move is to complete the job.
    const recorded = record();
    const result = await Effect.runPromise(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
            paymentById: payment({
              id: 'payment-0',
              status: 'authorised',
              providerReference: 'mock_auth_payment-0',
              totalCents: 7500
            }),
            items: basketReady.items,
            recorded
          })
        )
      )
    );

    expect(recorded.paymentsCreated).toHaveLength(0);
    expect(recorded.authorised).toHaveLength(0);
    expect(recorded.advances[0]).toMatchObject({
      from: { status: 'payment_pending', paymentId: 'payment-0' },
      set: { status: 'paid' }
    });
    expect(recorded.enqueued).toEqual(['order-1']);
    expect(result.verification.cost?.totalCents).toBe(7500);
  });

  it('retries a charge the provider never answered against the same row and key', async () => {
    // A `pending` row that outlived its request: the provider sees a retry of
    // ONE charge, keyed on the same payment id, never a second charge.
    const recorded = record();
    await Effect.runPromise(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
            paymentById: payment({ id: 'payment-0', status: 'pending' }),
            items: basketReady.items,
            recorded
          })
        )
      )
    );

    expect(recorded.paymentsCreated).toHaveLength(0);
    expect(recorded.claims).toHaveLength(0);
    expect(recorded.authorised).toEqual(['payment-0']);
    expect(recorded.enqueued).toEqual(['order-1']);
  });

  it('resumes an order whose previous charge failed', async () => {
    // A declined attempt whose revert never landed must not lock the
    // applicant out.
    const recorded = record();
    await Effect.runPromise(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
            paymentById: payment({ id: 'payment-0', status: 'failed' }),
            items: basketReady.items,
            recorded
          })
        )
      )
    );

    expect(recorded.claims[0]?.from).toEqual({ status: 'payment_pending', paymentId: 'payment-0' });
    expect(recorded.enqueued).toEqual(['order-1']);
  });

  it('refuses to charge for an empty basket', async () => {
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ openOrder: order(), items: [] }))
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses when nothing has been selected at all', async () => {
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer())
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses a second order while one is in progress', async () => {
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ openOrder: order({ status: 'invited' }) }))
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('refuses to order while a verdict is live', async () => {
    const recorded = record();
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(
          makeLayer({ ...basketReady, live: verification({ status: 'review_required' }), recorded })
        )
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
    expect(recorded.paymentsCreated).toHaveLength(0);
  });

  it('requires consent', async () => {
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: false }), new Headers()).pipe(
        Effect.provide(makeLayer(basketReady))
      )
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe('admin decisions', () => {
  const admin = user({ id: 'admin-1', role: 'admin' });

  it('approves and sets an expiry', async () => {
    const recorded = record();
    await Effect.runPromise(
      decideSafetyVerificationRouteProgram(
        contextWithJson({ decision: 'approve' }),
        new Headers(),
        'sv-1'
      ).pipe(Effect.provide(makeLayer({ user: admin, byId: verification(), recorded })))
    );

    expect(recorded.verificationUpdates[0]?.status).toBe('verified');
    expect(recorded.verificationUpdates[0]?.reviewedBy).toBe('admin-1');
    expect(recorded.verificationUpdates[0]?.expiresOn).toBeTruthy();
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
