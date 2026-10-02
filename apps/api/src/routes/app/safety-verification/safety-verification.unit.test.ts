import { makeCredibledTest, type CredibledCheckTypeValue } from '@repo/credibled';
import {
  DBNotFoundError,
  dummyBillingCustomer,
  makeCheckOrderRepoTest,
  makeFamilySearchOutboxRepoTest,
  makeInMemoryBillingCustomerRepo,
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
  type PaymentAdvanceInput,
  type PaymentCreateInput,
  type PaymentUpdateInput,
  type SafetyVerification,
  type SafetyVerificationCreateInput,
  type SafetyVerificationUpdateInput,
  type Session,
  type User
} from '@repo/db';
import {
  makeMockPayments,
  makePaymentsTest,
  PaymentDeclinedError,
  PaymentProviderError,
  type ProviderPaymentStatus,
  type StartPaymentInput
} from '@repo/payments';
import { makeFamilySearchQueueTest, makeSafetyVerificationQueueTest } from '@repo/queue';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  addSafetyVerificationItemRouteProgram,
  confirmSafetyCheckPaymentRouteProgram,
  decideSafetyVerificationRouteProgram,
  getMySafetyVerificationRouteProgram,
  orderSafetyCheckRouteProgram,
  submitSafetyDocumentRouteProgram
} from './safety-verification.handler';
import { makeNotificationHubTest, type NotificationInput } from '@repo/notify';

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
  /** What the provider was asked to start — one per charge attempt. */
  started: Array<StartPaymentInput>;
  /** Provider references resumed instead of started again. */
  resumed: Array<string>;
  cancelled: Array<string>;
  paymentAdvances: Array<PaymentAdvanceInput>;
  itemsAdded: Array<CheckOrderItemCreateInput>;
  paymentsCreated: Array<PaymentCreateInput>;
  paymentUpdates: Array<PaymentUpdateInput>;
  enqueued: Array<string>;
  /** Family user ids handed to the search reconcile queue. */
  reindexed: Array<string>;
  notified: Array<{ userId: string; input: NotificationInput }>;
};

const record = (): Recorded => ({
  verificationsCreated: [],
  verificationUpdates: [],
  ordersCreated: [],
  orderUpdates: [],
  claims: [],
  advances: [],
  started: [],
  resumed: [],
  cancelled: [],
  paymentAdvances: [],
  itemsAdded: [],
  paymentsCreated: [],
  paymentUpdates: [],
  enqueued: [],
  reindexed: [],
  notified: []
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
    /** Holds billing:write — keeps a card on file (families). */
    keepsCard?: boolean;
    billing?: ReturnType<typeof makeInMemoryBillingCustomerRepo>;
    /** Overrides the mock's instant success when a payment starts. */
    startedStatus?: ProviderPaymentStatus;
    resumedStatus?: ProviderPaymentStatus;
    /** What re-fetching the payment from the provider says. */
    fetchedStatus?: ProviderPaymentStatus;
    providerDown?: boolean;
    /** Starting the payment fails with a provider error (timeout, a
     * concurrent request holding the same key, Stripe down). */
    startProviderError?: boolean;
    /** A concurrent request records this provider reference on the row while
     * ours is being started. */
    concurrentReference?: string;
    /** The active gateway, when not the mock. */
    provider?: 'mock' | 'stripe';
    recorded?: Recorded;
  } = {}
) => {
  const currentUser = options.user ?? user();
  const currentSession = session(currentUser.id);
  const recorded = options.recorded ?? record();
  const openOrder = options.openOrder ?? null;
  // The order and payment rows as the request leaves them, so settle reads
  // back what the request wrote, the way the real repositories would.
  let currentOrder: CheckOrder | null = openOrder;
  let current: Payment | null = options.paymentById ?? null;
  const mockPayments = makeMockPayments();
  const providerError = (operation: 'getPayment' | 'resumePayment') =>
    Effect.fail(new PaymentProviderError({ operation, cause: 'provider down' }));

  return Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () =>
        Effect.succeed({ user: { id: currentUser.id }, session: { id: currentSession.id } }),
      userHasPermission: (_headers, permissions) =>
        Effect.succeed(
          'billing' in permissions ? (options.keepsCard ?? false) : (options.hasPermission ?? true)
        )
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
      findActiveById: () =>
        Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: '' })),
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
        currentOrder && currentOrder.id === id
          ? Effect.succeed(currentOrder)
          : Effect.fail(new DBNotFoundError({ entity: 'checkOrder', value: id })),
      findOpen: () => Effect.succeed(openOrder),
      findByPaymentId: (paymentId) =>
        Effect.succeed(currentOrder?.paymentId === paymentId ? currentOrder : null),
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
        if (options.claimLost) return Effect.succeed(null);
        currentOrder = order({
          ...(currentOrder ?? {}),
          status: 'payment_pending',
          paymentId: input.paymentId
        } as Partial<CheckOrder>);
        return Effect.succeed(currentOrder);
      },
      advance: (_id, input) => {
        recorded.advances.push(input);
        if (options.advanceLost) return Effect.succeed(null);
        currentOrder = order({ ...(currentOrder ?? {}), ...input.set } as Partial<CheckOrder>);
        return Effect.succeed(currentOrder);
      },
      complete: () => Effect.succeed(null),
      listInFlight: () => Effect.succeed([]),
      listAwaitingPlacement: () => Effect.succeed([]),
      listItems: () => Effect.succeed(options.items ?? []),
      listWithItems: () => Effect.succeed([]),
      addItem: (input) => {
        recorded.itemsAdded.push(input);
        return Effect.succeed(item({ ...input } as Partial<CheckOrderItem>));
      },
      removeItem: () => Effect.succeed(item())
    }),
    makePaymentRepoTest({
      findById: (id) =>
        current && current.id === id
          ? Effect.succeed(current)
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
      },
      advance: (_id, input) => {
        recorded.paymentAdvances.push(input);
        const from = Array.isArray(input.from) ? input.from : [input.from];
        if (current === null || !from.includes(current.status)) return Effect.succeed(null);
        if (
          input.providerReference !== undefined &&
          current.providerReference !== input.providerReference
        ) {
          return Effect.succeed(null);
        }
        current = payment({ ...current, ...input.set } as Partial<Payment>);
        return Effect.succeed(current);
      }
    }),
    (options.billing ?? makeInMemoryBillingCustomerRepo([])).layer,
    makePaymentsTest({
      ...(options.provider ? { provider: options.provider } : {}),
      startPayment: (input) => {
        recorded.started.push(input);
        if (options.concurrentReference && current !== null) {
          current = payment({ ...current, providerReference: options.concurrentReference });
        }
        if (options.startProviderError) {
          return Effect.fail(
            new PaymentProviderError({ operation: 'startPayment', cause: 'busy' })
          );
        }
        return options.declineCharge
          ? Effect.fail(new PaymentDeclinedError({ reason: 'card declined' }))
          : mockPayments
              .startPayment(input)
              .pipe(
                Effect.map((started) =>
                  options.startedStatus ? { ...started, status: options.startedStatus } : started
                )
              );
      },
      resumePayment: (reference) => {
        recorded.resumed.push(reference);
        return options.providerDown
          ? providerError('resumePayment')
          : Effect.succeed({
              reference,
              clientSecret: `secret_${reference}`,
              status: options.resumedStatus ?? 'requires_action',
              paymentMethodReference: null
            });
      },
      // A payment this request started is the mock's own; one left by an
      // earlier attempt (`paymentById`) reports the status the test asks for.
      getPayment: (reference) => {
        if (options.providerDown) return providerError('getPayment');
        if (reference.startsWith('mock_pi_')) return mockPayments.getPayment(reference);
        const status = options.fetchedStatus ?? 'succeeded';
        return Effect.succeed({
          reference,
          status,
          amountCents: current?.totalCents ?? 0,
          currency: 'cad',
          metadata: { payment_id: current?.id ?? '' },
          customer: null,
          savesCard: false,
          failureReason: status === 'failed' ? 'Your card was declined.' : null,
          receiptUrl: null,
          refundedCents: 0,
          paymentMethod: null
        });
      },
      cancelPayment: (reference) => {
        recorded.cancelled.push(reference);
        return Effect.succeed({
          reference,
          status: 'canceled' as const,
          amountCents: current?.totalCents ?? 0,
          currency: 'cad',
          metadata: { payment_id: current?.id ?? '' },
          customer: null,
          savesCard: false,
          failureReason: null,
          receiptUrl: null,
          refundedCents: 0,
          paymentMethod: null
        });
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
    }),
    // A decision on a FAMILY re-indexes them (their discoverability rides on
    // the verdict); the outbox row comes first, then the job.
    makeFamilySearchOutboxRepoTest({
      createPending: (userId) => Effect.succeed({ id: `outbox-${userId}`, userId } as never),
      listUnresolved: () => Effect.succeed([]),
      markProcessing: () => Effect.die('not used'),
      markProcessed: () => Effect.die('not used'),
      markFailed: () => Effect.die('not used'),
      markSupersededBefore: () => Effect.succeed(0)
    }),
    makeFamilySearchQueueTest({
      enqueueReconcile: ({ userId }) => {
        recorded.reindexed.push(userId);
        return Effect.succeed({ id: 'job-2', name: 'reconcile-family' });
      },
      enqueueReindex: () => Effect.die('not used')
    }),
    makeNotificationHubTest({
      publish: (userId, input) => {
        recorded.notified.push({ userId, input });
        return Effect.void;
      },
      subscribe: () => Effect.die('not used')
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
      ).pipe(
        Effect.provide(makeLayer({ types: [documentType({ credibledCheckTypeValue: null })] }))
      )
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
      item({
        id: 'item-2',
        credibledCheckTypeValue: 'request_motor_vehicle_records',
        costCents: 2500
      })
    ]
  };
  const family = user({ id: 'family-1', role: 'family', name: 'Fam Ily', email: 'f@example.com' });

  const placeOrder = (options: Parameters<typeof makeLayer>[0]) =>
    Effect.runPromise(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer(options))
      )
    );

  it('charges the summed basket once and, when the provider settles at once, hands the order to the worker', async () => {
    const recorded = record();
    const result = await placeOrder({ ...basketReady, recorded });

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
    expect(recorded.claims[0]?.paymentId).toBe('payment-1');
    // The payment row is the idempotency key and the intent's metadata.
    expect(recorded.started[0]).toMatchObject({
      idempotencyKey: 'payment-1',
      metadata: { payment_id: 'payment-1', order_id: 'order-1' }
    });
    // The intent is recorded only on a row still pending with none yet.
    expect(recorded.paymentAdvances[0]).toMatchObject({
      from: 'pending',
      providerReference: null,
      set: { providerReference: 'mock_pi_payment-1' }
    });
    // Settled through the shared path: captured, then the order is paid —
    // only if still claimed for THIS payment.
    expect(recorded.paymentAdvances[1]).toMatchObject({
      from: 'pending',
      set: { status: 'captured' }
    });
    expect(recorded.advances[0]).toMatchObject({
      from: { status: 'payment_pending', paymentId: 'payment-1' },
      set: { status: 'paid' }
    });
    expect(recorded.enqueued).toEqual(['order-1']);
    expect(recorded.verificationsCreated).toHaveLength(0);
    expect(result).toMatchObject({
      status: 'paid',
      verification: { status: 'payment_pending', cost: { totalCents: 7500 } }
    });
  });

  it('returns a client secret while the payer still has to confirm in the browser', async () => {
    const recorded = record();
    const result = await placeOrder({ ...basketReady, startedStatus: 'requires_action', recorded });

    expect(result).toEqual({
      status: 'payment_required',
      paymentId: 'payment-1',
      clientSecret: 'mock_secret_mock_pi_payment-1',
      provider: 'mock',
      // The row's frozen total: what the provider charges and the modal shows.
      totalCents: 7500,
      savesCard: false,
      savedCard: null
    });
    // Nothing is recorded as paid until settle sees the provider confirm:
    // the only write is the intent's reference.
    expect(recorded.paymentAdvances.map((input) => input.set)).toEqual([
      { providerReference: 'mock_pi_payment-1', lastError: null }
    ]);
    expect(recorded.advances).toHaveLength(0);
    expect(recorded.enqueued).toHaveLength(0);
  });

  it("creates a family's customer and asks for the first card to be kept", async () => {
    const recorded = record();
    const billing = makeInMemoryBillingCustomerRepo([]);
    const result = await placeOrder({
      ...basketReady,
      user: family,
      keepsCard: true,
      billing,
      startedStatus: 'requires_action',
      recorded
    });

    expect(recorded.started[0]).toMatchObject({
      customer: 'mock_cus_family-1',
      savedCard: null,
      saveCard: true,
      // The card choices are part of the key: a restart that chooses
      // differently is a different request, never a reused key.
      idempotencyKey: 'payment-1-save'
    });
    // The modal tells the family their new card will be kept.
    expect(result).toMatchObject({ status: 'payment_required', savesCard: true });
    expect(billing.rows.get('family-1')?.customerReference).toBe('mock_cus_family-1');
  });

  it('offers a family with a saved card one-click payment with it', async () => {
    const recorded = record();
    const result = await placeOrder({
      ...basketReady,
      user: family,
      keepsCard: true,
      billing: makeInMemoryBillingCustomerRepo([dummyBillingCustomer()]),
      startedStatus: 'requires_action',
      recorded
    });

    expect(recorded.started[0]).toMatchObject({
      savedCard: 'mock_pm_saved',
      saveCard: false,
      idempotencyKey: 'payment-1-card-mock_pm_saved'
    });
    expect(result).toMatchObject({
      status: 'payment_required',
      savesCard: false,
      savedCard: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 }
    });
  });

  it('charges a helper one-off: no customer, nothing kept', async () => {
    const recorded = record();
    await placeOrder({ ...basketReady, keepsCard: false, recorded });
    expect(recorded.started[0]).toMatchObject({ customer: null, savedCard: null, saveCard: false });
  });

  it('releases the order and records the failure when the provider refuses to start', async () => {
    const recorded = record();
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ ...basketReady, declineCharge: true, recorded }))
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationPaymentError');
    // Guarded: only a row still pending with no intent recorded is failed.
    expect(recorded.paymentAdvances[0]).toMatchObject({
      from: 'pending',
      providerReference: null,
      set: { status: 'failed', lastError: 'card declined' }
    });
    expect(recorded.advances[0]).toMatchObject({
      from: { status: 'payment_pending', paymentId: 'payment-1' },
      set: { status: 'draft', paymentId: null }
    });
    expect(recorded.enqueued).toHaveLength(0);
  });

  it('never charges twice when two requests race for the same draft', async () => {
    const recorded = record();
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ ...basketReady, claimLost: true, recorded }))
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
    expect(recorded.paymentUpdates[0]?.status).toBe('failed');
    expect(recorded.started).toHaveLength(0);
    expect(recorded.enqueued).toHaveLength(0);
  });

  it('flags a settled charge whose order moved before it could be marked paid', async () => {
    const recorded = record();
    await placeOrder({ ...basketReady, advanceLost: true, recorded });

    expect(recorded.paymentUpdates.at(-1)?.lastError).toMatch(/manual settlement/);
    expect(recorded.enqueued).toHaveLength(0);
  });

  it('finishes an order whose charge already landed instead of charging again', async () => {
    const recorded = record();
    const result = await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({
        id: 'payment-0',
        status: 'captured',
        providerReference: 'mock_pi_payment-0',
        totalCents: 7500
      }),
      items: basketReady.items,
      recorded
    });

    expect(recorded.paymentsCreated).toHaveLength(0);
    expect(recorded.started).toHaveLength(0);
    expect(recorded.advances[0]).toMatchObject({
      from: { status: 'payment_pending', paymentId: 'payment-0' },
      set: { status: 'paid' }
    });
    expect(recorded.enqueued).toEqual(['order-1']);
    expect(result).toMatchObject({ status: 'paid', verification: { cost: { totalCents: 7500 } } });
  });

  it('restarts a payment the provider never received against the same row and key', async () => {
    const recorded = record();
    await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({ id: 'payment-0', status: 'pending', providerReference: null }),
      items: basketReady.items,
      recorded
    });

    expect(recorded.paymentsCreated).toHaveLength(0);
    expect(recorded.claims).toHaveLength(0);
    expect(recorded.started.map((input) => input.idempotencyKey)).toEqual(['payment-0']);
  });

  it('leaves the row pending and the order claimed when the provider errors on a restart', async () => {
    // The provider may still have created the intent (a timeout, or a
    // concurrent request holding the same key that handed it to the
    // browser). Failing the row would orphan money paid into that intent.
    const recorded = record();
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
            paymentById: payment({ id: 'payment-0', status: 'pending', providerReference: null }),
            items: basketReady.items,
            startProviderError: true,
            recorded
          })
        )
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationVendorError');
    expect(recorded.paymentUpdates).toHaveLength(0);
    expect(recorded.paymentAdvances).toHaveLength(0);
    expect(recorded.advances).toHaveLength(0);
  });

  it('leaves a fresh row pending too when the provider errors on the first start', async () => {
    const recorded = record();
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ ...basketReady, startProviderError: true, recorded }))
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationVendorError');
    expect(recorded.paymentAdvances).toHaveLength(0);
    // The order stays claimed: the next attempt restarts the same row and key.
    expect(recorded.advances).toHaveLength(0);
  });

  it('cancels its own intent and hands out nothing when a concurrent request recorded another', async () => {
    const recorded = record();
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
            paymentById: payment({ id: 'payment-0', status: 'pending', providerReference: null }),
            items: basketReady.items,
            startedStatus: 'requires_action',
            concurrentReference: 'pi_other',
            recorded
          })
        )
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
    expect(recorded.cancelled).toEqual(['mock_pi_payment-0']);
    expect(recorded.paymentUpdates).toHaveLength(0);
  });

  it('abandons a reference-less row left by another provider and charges a fresh one', async () => {
    const recorded = record();
    const result = await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({ id: 'payment-0', status: 'pending', provider: 'stripe' }),
      items: basketReady.items,
      startedStatus: 'requires_action',
      recorded
    });

    expect(recorded.paymentAdvances[0]).toMatchObject({
      from: 'pending',
      set: { status: 'failed', lastError: 'abandoned at provider switch' }
    });
    expect(recorded.claims[0]?.from).toEqual({ status: 'payment_pending', paymentId: 'payment-0' });
    // Never started against the old provider's row.
    expect(recorded.started.map((input) => input.idempotencyKey)).toEqual(['payment-1']);
    expect(recorded.paymentsCreated[0]).toMatchObject({ provider: 'mock' });
    expect(result).toMatchObject({ status: 'payment_required', paymentId: 'payment-1' });
  });

  it('abandons a referenced row left by another provider instead of resuming it', async () => {
    const recorded = record();
    const result = await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({
        id: 'payment-0',
        status: 'pending',
        provider: 'stripe',
        providerReference: 'pi_0'
      }),
      items: basketReady.items,
      startedStatus: 'requires_action',
      recorded
    });

    expect(recorded.resumed).toHaveLength(0);
    expect(recorded.paymentAdvances[0]).toMatchObject({
      from: 'pending',
      set: { status: 'failed', lastError: 'abandoned at provider switch' }
    });
    expect(recorded.claims[0]?.from).toEqual({ status: 'payment_pending', paymentId: 'payment-0' });
    expect(result).toMatchObject({ status: 'payment_required', paymentId: 'payment-1' });
  });

  it('charges the restarted row its own frozen total, never a freshly recomputed quote', async () => {
    // The row was frozen at an earlier attempt; if pricing changed since
    // (fee, tax, item cost), the provider must still be charged what the row
    // records — never a figure recomputed from the current basket.
    const recorded = record();
    await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({
        id: 'payment-0',
        status: 'pending',
        providerReference: null,
        amountCents: 6000,
        feeCents: 400,
        taxCents: 0,
        totalCents: 6400
      }),
      items: basketReady.items,
      recorded
    });

    expect(recorded.started[0]?.quote).toMatchObject({
      amountCents: 6000,
      feeCents: 400,
      taxCents: 0,
      totalCents: 6400
    });
  });

  it('resumes an unfinished payment with a fresh client secret — never a second intent', async () => {
    const recorded = record();
    const result = await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({ id: 'payment-0', status: 'pending', providerReference: 'pi_0' }),
      items: basketReady.items,
      recorded
    });

    expect(recorded.resumed).toEqual(['pi_0']);
    expect(recorded.started).toHaveLength(0);
    expect(recorded.paymentsCreated).toHaveLength(0);
    expect(result).toMatchObject({
      status: 'payment_required',
      paymentId: 'payment-0',
      clientSecret: 'secret_pi_0',
      totalCents: 0
    });
  });

  it('settles a resumed payment the provider already finished', async () => {
    const recorded = record();
    const result = await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({
        id: 'payment-0',
        status: 'pending',
        providerReference: 'pi_0',
        totalCents: 7500
      }),
      resumedStatus: 'succeeded',
      fetchedStatus: 'succeeded',
      items: basketReady.items,
      recorded
    });

    expect(result).toMatchObject({ status: 'paid' });
    expect(recorded.enqueued).toEqual(['order-1']);
  });

  it('starts a fresh payment when the resumed one had been declined', async () => {
    const recorded = record();
    await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({
        id: 'payment-0',
        status: 'pending',
        providerReference: 'pi_0',
        totalCents: 7500
      }),
      resumedStatus: 'failed',
      fetchedStatus: 'failed',
      items: basketReady.items,
      recorded
    });

    // The declined intent is cancelled and its order released by settle;
    // then the basket is claimed again for a new row.
    expect(recorded.cancelled).toEqual(['pi_0']);
    expect(recorded.claims[0]?.from).toEqual({ status: 'draft', paymentId: null });
    expect(recorded.started[0]?.idempotencyKey).toBe('payment-1');
  });

  it('resumes an order whose previous charge failed', async () => {
    const recorded = record();
    await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({ id: 'payment-0', status: 'failed' }),
      items: basketReady.items,
      recorded
    });

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

  it('tells the page a started payment can be resumed', async () => {
    const result = await Effect.runPromise(
      getMySafetyVerificationRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
            paymentById: payment({ id: 'payment-0', status: 'pending', providerReference: 'pi_0' }),
            items: basketReady.items
          })
        )
      )
    );
    expect(result.canResumePayment).toBe(true);
  });
});

describe('confirming a payment from the browser', () => {
  const PAYMENT_ID = '3f0c7a52-8a4b-4c1e-9d5f-2b7e6a1c0d94';
  const pendingPayment = {
    openOrder: order({ status: 'payment_pending', paymentId: PAYMENT_ID }),
    paymentById: payment({
      id: PAYMENT_ID,
      status: 'pending',
      providerReference: 'pi_0',
      totalCents: 7500
    })
  };
  const confirm = (
    options: Parameters<typeof makeLayer>[0],
    body: unknown = { paymentId: PAYMENT_ID }
  ) =>
    Effect.runPromiseExit(
      confirmSafetyCheckPaymentRouteProgram(contextWithJson(body), new Headers()).pipe(
        Effect.provide(makeLayer(options))
      )
    );

  it('reports paid once the provider confirms, and moves the order on', async () => {
    const recorded = record();
    const exit = await confirm({ ...pendingPayment, fetchedStatus: 'succeeded', recorded });
    expect(exit).toEqual(Exit.succeed({ status: 'paid', message: null }));
    expect(recorded.enqueued).toEqual(['order-1']);
  });

  it("reports a decline with the provider's message and releases the order", async () => {
    const recorded = record();
    const exit = await confirm({ ...pendingPayment, fetchedStatus: 'failed', recorded });
    expect(exit).toEqual(Exit.succeed({ status: 'failed', message: 'Your card was declined.' }));
    expect(recorded.advances.at(-1)).toMatchObject({ set: { status: 'draft', paymentId: null } });
  });

  it('reports pending while 3-D Secure is still open', async () => {
    const exit = await confirm({ ...pendingPayment, fetchedStatus: 'requires_action' });
    expect(exit).toEqual(Exit.succeed({ status: 'pending', message: null }));
  });

  it("refuses somebody else's payment as not found", async () => {
    const exit = await confirm({
      ...pendingPayment,
      paymentById: payment({ id: PAYMENT_ID, userId: 'someone-else', providerReference: 'pi_0' })
    });
    expect(failureTag(exit)).toBe('SafetyVerificationNotFoundError');
  });

  it('turns an unreachable provider into an unavailable error', async () => {
    const exit = await confirm({ ...pendingPayment, providerDown: true });
    expect(failureTag(exit)).toBe('SafetyVerificationVendorError');
  });

  it('denies an applicant without the write permission', async () => {
    const exit = await confirm({ ...pendingPayment, hasPermission: false });
    expect(failureTag(exit)).toBe('ForbiddenError');
  });

  it('rejects a body without a payment id', async () => {
    const exit = await confirm(pendingPayment, {});
    expect(failureTag(exit)).toBe('RequestValidationError');
  });

  it('rejects a payment id that is not a uuid before it reaches the database', async () => {
    const exit = await confirm(pendingPayment, { paymentId: 'payment-0' });
    expect(failureTag(exit)).toBe('RequestValidationError');
  });

  it('refuses an unknown payment id as not found', async () => {
    const exit = await confirm(pendingPayment, {
      paymentId: '00000000-0000-4000-8000-000000000000'
    });
    expect(failureTag(exit)).toBe('SafetyVerificationNotFoundError');
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
    // The applicant hears about the verdict on their open page.
    expect(recorded.notified.map((entry) => entry.input.payload)).toEqual([{ status: 'verified' }]);
  });

  it('re-indexes a family on either decision, and never a helper', async () => {
    for (const decision of [{ decision: 'approve' }, { decision: 'reject', reason: 'No.' }]) {
      const recorded = record();
      await Effect.runPromise(
        decideSafetyVerificationRouteProgram(contextWithJson(decision), new Headers(), 'sv-1').pipe(
          Effect.provide(
            makeLayer({
              user: admin,
              byId: verification({ role: 'family', userId: 'family-1' }),
              recorded
            })
          )
        )
      );
      expect(recorded.reindexed).toEqual(['family-1']);
    }

    // A helper's discoverability rides on their approval, which already
    // requires the verdict — nothing to re-index here.
    const recorded = record();
    await Effect.runPromise(
      decideSafetyVerificationRouteProgram(
        contextWithJson({ decision: 'approve' }),
        new Headers(),
        'sv-1'
      ).pipe(Effect.provide(makeLayer({ user: admin, byId: verification(), recorded })))
    );
    expect(recorded.reindexed).toEqual([]);
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
      ).pipe(Effect.provide(makeLayer({ user: admin, byId: verification({ status: 'rejected' }) })))
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
