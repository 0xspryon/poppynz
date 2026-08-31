import { SqlError } from '@effect/sql/SqlError';
import {
  DBNotFoundError,
  makeKycDocumentRepoTest,
  makeKycDocumentTypeRepoTest,
  makeSafetyVerificationRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type KycDocument,
  type KycDocumentSubmitInput,
  type KycDocumentType,
  type KycDocumentTypeCreateInput,
  type KycDocumentTypeUpdateInput,
  type Session,
  type User
} from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  createKycDocumentTypeRouteProgram,
  deleteKycDocumentTypeRouteProgram,
  submitKycDocumentRouteProgram,
  updateAdminKycDocumentRouteProgram,
  updateKycDocumentTypeRouteProgram
} from './kyc-docs.handler';

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

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  expiresAt: new Date('2026-06-13T00:00:00.000Z'),
  token: 'session-token',
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ipAddress: null,
  userAgent: null,
  userId: 'provider-1',
  impersonatedBy: null,
  activeOrganizationId: null,
  ...overrides
});

const documentType = (overrides: Partial<KycDocumentType> = {}): KycDocumentType => ({
  id: 'document-type-1',
  name: 'Government ID',
  appliesToRole: 'service-provider',
  isOptional: false,
  requiresExpiryDate: true,
  credibledCheckTypeValue: null,
  credibledCostCents: null,
  backsSafetyVerification: false,
  deletedAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides
});

const kycDocument = (overrides: Partial<KycDocument> = {}): KycDocument => ({
  id: 'kyc-document-1',
  userId: 'provider-1',
  documentTypeId: 'document-type-1',
  filename: 'government-id.pdf',
  fileKey: 'users/provider-1/kyc/document-type-1/government-id.pdf',
  expiryDate: new Date('2027-06-12T00:00:00.000Z'),
  status: 'submitted',
  reason: null,
  deletedAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides
});

const contextWithJson = (body: unknown) =>
  ({ req: { json: async () => body } }) as HonoContext<HonoEnv>;

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
    type?: KycDocumentType | null;
    document?: KycDocument | null;
    createTypeError?: SqlError;
    submitError?: SqlError;
    onCreateType?: (input: KycDocumentTypeCreateInput) => void;
    onUpdateType?: (input: KycDocumentTypeUpdateInput) => void;
    onSubmit?: (input: KycDocumentSubmitInput) => void;
    safetyLive?: { id: string; status: string } | null;
    safetyItems?: Array<{ id: string; documentTypeId: string }>;
    onRemoveItem?: (itemId: string) => void;
  } = {}
) => {
  const currentUser = options.user ?? user();
  const currentSession = session({ userId: currentUser.id });
  const currentType = options.type === undefined ? documentType() : options.type;
  const currentDocument = options.document === undefined ? kycDocument() : options.document;

  return Layer.mergeAll(
    // Uploading yourself drops the matching Credibled basket item; this suite
    // has no basket, so the lookup finds nothing.
    makeSafetyVerificationRepoTest({
      findLive: () => Effect.succeed((options.safetyLive ?? null) as never),
      findById: () => Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: '' })),
      findByCredibledUuid: () => Effect.succeed(null),
      listByUser: () => Effect.succeed([]),
      listForReview: () => Effect.succeed([]),
      create: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' }) as never),
      update: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' })),
      listExpiringForNotification: () => Effect.succeed([]),
      markExpiryNotified: () =>
        Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: '' })),
      listLapsed: () => Effect.succeed([]),
      listInFlight: () => Effect.succeed([]),
      listAwaitingOrder: () => Effect.succeed([]),
      listItems: () => Effect.succeed((options.safetyItems ?? []) as never),
      addItem: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' }) as never),
      removeItem: (_verificationId, itemId) => {
        options.onRemoveItem?.(itemId);
        return Effect.succeed({ id: itemId } as never);
      }
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
    makeKycDocumentTypeRepoTest({
      listActive: () => Effect.succeed(currentType ? [currentType] : []),
      findActiveById: (id) =>
        currentType?.id === id && currentType.deletedAt === null
          ? Effect.succeed(currentType)
          : Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: id })),
      create: (input) => {
        options.onCreateType?.(input);
        return options.createTypeError
          ? Effect.fail(options.createTypeError)
          : Effect.succeed(documentType(input));
      },
      update: (id, input) => {
        options.onUpdateType?.(input);
        return currentType?.id === id
          ? Effect.succeed({ ...currentType, ...input })
          : Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: id }));
      },
      softDelete: (id) =>
        currentType?.id === id
          ? Effect.succeed({ ...currentType, deletedAt: new Date('2026-06-13T00:00:00.000Z') })
          : Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: id }))
    }),
    makeKycDocumentRepoTest({
      findByIdWithType: (id) =>
        currentDocument?.id === id && currentType
          ? Effect.succeed({ ...currentDocument, documentType: currentType })
          : Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: id })),
      findByUserId: () => Effect.succeed([]),
      findByUserIdWithTypes: () => Effect.succeed([]),
      submit: (input) => {
        options.onSubmit?.(input);
        return options.submitError
          ? Effect.fail(options.submitError)
          : Effect.succeed(kycDocument(input));
      },
      updateExpiryDate: (id, expiryDate) =>
        currentDocument?.id === id
          ? Effect.succeed({ ...currentDocument, expiryDate })
          : Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: id })),
      approveSubmittedByUserId: () => Effect.succeed([])
    })
  );
};

describe('KYC route programs', () => {
  it('creates a document type with default service-provider role', async () => {
    const created: Array<KycDocumentTypeCreateInput> = [];
    const result = await Effect.runPromise(
      createKycDocumentTypeRouteProgram(
        contextWithJson({
          name: ' Vulnerable Sector Check ',
          isOptional: false,
          requiresExpiryDate: true
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ onCreateType: (input) => created.push(input) })))
    );

    expect(result).toMatchObject({
      name: 'Vulnerable Sector Check',
      appliesToRole: 'service-provider',
      isOptional: false,
      requiresExpiryDate: true
    });
    expect(created).toEqual([
      {
        name: 'Vulnerable Sector Check',
        isOptional: false,
        requiresExpiryDate: true,
        appliesToRole: 'service-provider'
      }
    ]);
  });

  it('round-trips the Credibled check type on create and update', async () => {
    const created: Array<KycDocumentTypeCreateInput> = [];
    const result = await Effect.runPromise(
      createKycDocumentTypeRouteProgram(
        contextWithJson({
          name: 'Criminal record check',
          isOptional: false,
          requiresExpiryDate: true,
          credibledCheckTypeValue: 'request_enhanced_criminal_record_check',
          credibledCostCents: 4500
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ onCreateType: (input) => created.push(input) })))
    );
    expect(result).toMatchObject({
      credibledCheckTypeValue: 'request_enhanced_criminal_record_check'
    });
    expect(created[0]).toMatchObject({
      credibledCheckTypeValue: 'request_enhanced_criminal_record_check'
    });

    const updates: Array<KycDocumentTypeUpdateInput> = [];
    const updated = await Effect.runPromise(
      updateKycDocumentTypeRouteProgram(
        contextWithJson({
          credibledCheckTypeValue: 'request_motor_vehicle_records',
          credibledCostCents: 2500
        }),
        new Headers(),
        'document-type-1'
      ).pipe(Effect.provide(makeLayer({ onUpdateType: (input) => updates.push(input) })))
    );
    expect(updated).toMatchObject({ credibledCheckTypeValue: 'request_motor_vehicle_records' });
    expect(updates).toEqual([
      { credibledCheckTypeValue: 'request_motor_vehicle_records', credibledCostCents: 2500 }
    ]);
  });

  it('drops the matching Credibled basket item when you upload it yourself', async () => {
    // Uploading supersedes having Credibled fetch it — nobody should be
    // charged for a check they have just provided.
    const removed: Array<string> = [];
    await Effect.runPromise(
      submitKycDocumentRouteProgram(
        contextWithJson({
          documentTypeId: 'document-type-1',
          filename: 'a.pdf',
          fileKey: 'users/provider-1/a.pdf',
          expiryDate: '2099-01-01T00:00:00.000Z'
        }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            safetyLive: { id: 'sv-1', status: 'not_started' },
            safetyItems: [{ id: 'item-1', documentTypeId: 'document-type-1' }],
            onRemoveItem: (id) => removed.push(id)
          })
        )
      )
    );

    expect(removed).toEqual(['item-1']);
  });

  it('leaves the basket alone when the uploaded type is not queued', async () => {
    const removed: Array<string> = [];
    await Effect.runPromise(
      submitKycDocumentRouteProgram(
        contextWithJson({
          documentTypeId: 'document-type-1',
          filename: 'a.pdf',
          fileKey: 'users/provider-1/a.pdf',
          expiryDate: '2099-01-01T00:00:00.000Z'
        }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            safetyLive: { id: 'sv-1', status: 'not_started' },
            safetyItems: [{ id: 'item-9', documentTypeId: 'other-type' }],
            onRemoveItem: (id) => removed.push(id)
          })
        )
      )
    );

    expect(removed).toEqual([]);
  });

  it('refuses to make a document type fetchable without a price', async () => {
    // A priceless fetchable type would quote the applicant nothing for a check
    // Poppynz still gets billed for.
    const exit = await Effect.runPromiseExit(
      createKycDocumentTypeRouteProgram(
        contextWithJson({
          name: 'Driver abstract',
          isOptional: true,
          requiresExpiryDate: false,
          credibledCheckTypeValue: 'request_motor_vehicle_records'
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({})))
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('refuses a price on an upload-only document type', async () => {
    const exit = await Effect.runPromiseExit(
      createKycDocumentTypeRouteProgram(
        contextWithJson({
          name: 'Vulnerable sector check',
          isOptional: true,
          requiresExpiryDate: true,
          credibledCheckTypeValue: null,
          credibledCostCents: 4500
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({})))
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('rejects a Credibled check type outside the catalogue', async () => {
    const exit = await Effect.runPromiseExit(
      createKycDocumentTypeRouteProgram(
        contextWithJson({
          name: 'Vulnerable sector check',
          isOptional: false,
          requiresExpiryDate: true,
          // Credibled offers no vulnerable-sector product, so no value can be
          // saved for one — the catalogue union is the guard.
          credibledCheckTypeValue: 'request_vulnerable_sector_check'
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({})))
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('rejects document type writes without permission', async () => {
    const exit = await Effect.runPromise(
      createKycDocumentTypeRouteProgram(
        contextWithJson({ name: 'ID', isOptional: false, requiresExpiryDate: false }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ hasPermission: false })), Effect.exit)
    );

    expect(getFailure(exit)._tag).toBe('ForbiddenError');
  });

  it('updates and soft-deletes document types', async () => {
    const updates: Array<KycDocumentTypeUpdateInput> = [];
    const updated = await Effect.runPromise(
      updateKycDocumentTypeRouteProgram(
        contextWithJson({ isOptional: true }),
        new Headers(),
        'document-type-1'
      ).pipe(Effect.provide(makeLayer({ onUpdateType: (input) => updates.push(input) })))
    );
    const deleted = await Effect.runPromise(
      deleteKycDocumentTypeRouteProgram(new Headers(), 'document-type-1').pipe(
        Effect.provide(makeLayer())
      )
    );

    expect(updated.isOptional).toBe(true);
    expect(updates).toEqual([{ isOptional: true }]);
    expect(deleted.deletedAt).toBe('2026-06-13T00:00:00.000Z');
  });

  it('submits a required KYC document with expiry', async () => {
    const submitted: Array<KycDocumentSubmitInput> = [];
    const result = await Effect.runPromise(
      submitKycDocumentRouteProgram(
        contextWithJson({
          documentTypeId: 'document-type-1',
          filename: 'id.pdf',
          fileKey: 'users/provider-1/kyc/document-type-1/id.pdf',
          expiryDate: '2027-06-12T00:00:00.000Z'
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ onSubmit: (input) => submitted.push(input) })))
    );

    expect(result).toMatchObject({
      documentTypeId: 'document-type-1',
      filename: 'id.pdf',
      status: 'submitted'
    });
    expect(submitted[0]).toMatchObject({
      userId: 'provider-1',
      documentTypeId: 'document-type-1',
      fileKey: 'users/provider-1/kyc/document-type-1/id.pdf'
    });
  });

  it('rejects missing required expiry and foreign file keys', async () => {
    const missingExpiry = await Effect.runPromise(
      submitKycDocumentRouteProgram(
        contextWithJson({
          documentTypeId: 'document-type-1',
          filename: 'id.pdf',
          fileKey: 'users/provider-1/kyc/document-type-1/id.pdf'
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer()), Effect.exit)
    );
    const foreignKey = await Effect.runPromise(
      submitKycDocumentRouteProgram(
        contextWithJson({
          documentTypeId: 'document-type-1',
          filename: 'id.pdf',
          fileKey: 'users/other/kyc/document-type-1/id.pdf',
          expiryDate: '2027-06-12T00:00:00.000Z'
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer()), Effect.exit)
    );

    expect(getFailure(missingExpiry)._tag).toBe('KycValidationError');
    expect(getFailure(foreignKey)._tag).toBe('KycValidationError');
  });

  it('rejects family users submitting service-provider KYC docs', async () => {
    const exit = await Effect.runPromise(
      submitKycDocumentRouteProgram(
        contextWithJson({
          documentTypeId: 'document-type-1',
          filename: 'id.pdf',
          fileKey: 'users/provider-1/kyc/document-type-1/id.pdf',
          expiryDate: '2027-06-12T00:00:00.000Z'
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ user: user({ role: 'family' }) })), Effect.exit)
    );

    expect(getFailure(exit)._tag).toBe('KycValidationError');
  });

  it('updates admin KYC document expiry and rejects null when required', async () => {
    const updated = await Effect.runPromise(
      updateAdminKycDocumentRouteProgram(
        contextWithJson({ expiryDate: '2027-07-01T00:00:00.000Z' }),
        new Headers(),
        'kyc-document-1'
      ).pipe(Effect.provide(makeLayer()))
    );
    const nullExpiry = await Effect.runPromise(
      updateAdminKycDocumentRouteProgram(
        contextWithJson({ expiryDate: null }),
        new Headers(),
        'kyc-document-1'
      ).pipe(Effect.provide(makeLayer()), Effect.exit)
    );

    expect(updated.expiryDate).toBe('2027-07-01T00:00:00.000Z');
    expect(getFailure(nullExpiry)._tag).toBe('KycValidationError');
  });

  it('translates missing KYC records and repo failures', async () => {
    const missingType = await Effect.runPromise(
      submitKycDocumentRouteProgram(
        contextWithJson({
          documentTypeId: 'missing',
          filename: 'id.pdf',
          fileKey: 'users/provider-1/kyc/missing/id.pdf',
          expiryDate: '2027-06-12T00:00:00.000Z'
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ type: null })), Effect.exit)
    );
    const repoFailure = await Effect.runPromise(
      createKycDocumentTypeRouteProgram(
        contextWithJson({ name: 'ID', isOptional: false, requiresExpiryDate: false }),
        new Headers()
      ).pipe(
        Effect.provide(makeLayer({ createTypeError: new SqlError({ message: 'db down' }) })),
        Effect.exit
      )
    );

    expect(getFailure(missingType)._tag).toBe('KycNotFoundError');
    expect(getFailure(repoFailure)._tag).toBe('KycRepoError');
  });
});
