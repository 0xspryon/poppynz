import { makeIdleContractBillingLayer } from '@repo/billing';
import {
  DBNotFoundError,
  dummyBillingCustomer,
  dummyContract,
  dummyContractAgreementSignature,
  dummyContractVersion,
  emptyTcDocumentRepo,
  makeApprovalRepoTest,
  makeContractAgreementRepoTest,
  makeContractRepoTest,
  makeInMemoryBillingCustomerRepo,
  makeServiceOfferedRepoTest,
  makeSessionRepoTest,
  makeTcDocumentRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  type Contract,
  type ContractAgreementSignature,
  type ContractVersion,
  type SafeUserProfile,
  type Session,
  type TcDocument,
  type TcDocumentVersion,
  type User
} from '@repo/db';
import { makeNotificationHubTest } from '@repo/notify';
import { makePaymentsTest } from '@repo/payments';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest, type UserAndSession } from '@/api/lib/effect-auth';
import { agreementValues, sha256Hex, type AgreementValuesInput } from './agreement';
import { getAgreementToSignProgram, getSignedAgreementRouteProgram } from './agreement.handler';
import { acceptContractProgram, sendContractProgram } from './contracts.handler';

const CONTRACT_ID = '0198a3b0-0000-7000-8000-00000000c001';
const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const WPG = 'America/Winnipeg';
const at = new Date('2026-10-01T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Fixtures

const member = (id: string, role: 'family' | 'service-provider' | 'admin'): User => ({
  id,
  name: `${id} name`,
  email: `${id}@example.com`,
  emailVerified: true,
  image: null,
  createdAt: at,
  updatedAt: at,
  isAnonymous: false,
  role,
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null
});
const family = member('family-1', 'family');
const helper = member('provider-1', 'service-provider');
const admin = member('admin-1', 'admin');
const outsider = member('family-2', 'family');

const session = (userId: string, impersonatedBy: string | null = null): Session => ({
  id: 'session-1',
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  token: 'token',
  createdAt: at,
  updatedAt: at,
  ipAddress: null,
  userAgent: null,
  userId,
  impersonatedBy,
  activeOrganizationId: null
});

const signedIn = (user: User, impersonatedBy: string | null = null): UserAndSession => ({
  user,
  session: session(user.id, impersonatedBy)
});

const profile = (userId: string, firstName: string, city: string, province: string) =>
  ({
    userId,
    email: `${userId}@example.com`,
    role: userId === 'family-1' ? 'family' : 'service-provider',
    language: 'en',
    firstName,
    lastName: 'Tester',
    gender: null,
    phoneNumber: null,
    dateOfBirth: null,
    address: null,
    city,
    postalCode: null,
    country: 'CA',
    stateProvince: province,
    shortBio: null,
    googlePlaceId: null,
    // Winnipeg.
    latitude: userId === 'family-1' ? 49.8951 : null,
    longitude: userId === 'family-1' ? -97.1384 : null
  }) satisfies SafeUserProfile;

const services = [
  {
    serviceId: SERVICE_ID,
    name: 'Childcare',
    listedRateCents: 2500,
    rateCents: 2600,
    currency: 'CAD',
    // Thu then Tue, deliberately out of order.
    sessions: [
      { weekday: 3, startMinutes: 930, endMinutes: 1050 },
      { weekday: 1, startMinutes: 930, endMinutes: 1050 }
    ],
    expectations: 'Reading practice.'
  }
];

const contract = (overrides: Partial<Contract> = {}): Contract => ({
  ...dummyContract,
  id: CONTRACT_ID,
  ...overrides
});

const draft = (overrides: Partial<ContractVersion> = {}): ContractVersion => ({
  ...dummyContractVersion,
  id: 'version-1',
  contractId: CONTRACT_ID,
  services,
  startsOn: '2099-01-05',
  timeZone: null,
  ...overrides
});
const proposed = (overrides: Partial<ContractVersion> = {}) =>
  draft({ status: 'proposed', sentAt: new Date(), timeZone: WPG, ...overrides });

const TEMPLATE =
  'Between {{family.name}} ({{family.location}}) and {{helper.name}} ({{helper.location}}).\n' +
  '{{#services}}\n- {{name}} at {{rate}}/h\n{{/services}}\n' +
  'Starts {{contract.startsOn}}. Policy v{{cancellation.policyVersion}}.';

const agreementDoc: TcDocument = {
  id: 'agreement-doc',
  slug: 'service_agreement',
  title: 'Service Agreement',
  appliesToRole: 'all',
  kind: 'service_agreement',
  deletedAt: null,
  createdAt: at,
  updatedAt: at
};
const templateRow = (overrides: Partial<TcDocumentVersion> = {}): TcDocumentVersion => ({
  id: 'agreement-v1-en',
  documentId: 'agreement-doc',
  locale: 'en',
  version: 1,
  description: 'Default',
  content: TEMPLATE,
  checkboxLabel: 'I have read and agree.',
  publishedAt: at,
  createdAt: at,
  updatedAt: at,
  ...overrides
});
const termsDoc: TcDocument = {
  ...agreementDoc,
  id: 'tos-doc',
  slug: 'terms_of_service',
  title: 'Terms of Service and Payment Policy',
  kind: 'terms'
};
const tosRow = templateRow({ id: 'tos-v3', documentId: 'tos-doc', version: 3, content: '# ToS' });

type Recorded = { sent: Array<unknown>; accepted: Array<unknown> };

const makeLayer = (
  options: {
    viewer?: User;
    impersonatedBy?: string | null;
    reviewer?: boolean;
    contract?: Contract;
    versions?: Array<ContractVersion>;
    templates?: Array<TcDocumentVersion> | null;
    signatures?: Array<ContractAgreementSignature>;
    recorded?: Recorded;
  } = {}
) => {
  const viewer = options.viewer ?? family;
  const users = [family, helper, admin, outsider];
  return Layer.mergeAll(
    makeIdleContractBillingLayer(),
    makeInMemoryBillingCustomerRepo([dummyBillingCustomer()]).layer,
    makePaymentsTest({}),
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: viewer.id }, session: { id: 'session-1' } }),
      userHasPermission: (_headers, permissions) =>
        Effect.succeed(
          (permissions as { contract?: Array<string> }).contract?.includes('review')
            ? (options.reviewer ?? false)
            : true
        )
    }),
    makeUserRepoTest({
      findById: (id) => {
        const found = users.find((user) => user.id === id);
        return found
          ? Effect.succeed(found)
          : Effect.fail(new DBNotFoundError({ entity: 'user', value: id }));
      },
      findByEmail: () => Effect.die('not used')
    }),
    makeSessionRepoTest({
      findById: () => Effect.succeed(session(viewer.id, options.impersonatedBy ?? null))
    }),
    makeUserProfileRepoTest({
      create: () => Effect.die('not used'),
      findByUserId: (userId) =>
        userId === 'family-1'
          ? Effect.succeed(profile('family-1', 'Priya', 'Winnipeg', 'MB'))
          : userId === 'provider-1'
            ? Effect.succeed(profile('provider-1', 'Maria', 'Brandon', 'MB'))
            : Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId })),
      updateByUserId: () => Effect.die('not used'),
      updateLocationByUserId: () => Effect.die('not used')
    }),
    makeServiceOfferedRepoTest({
      listByUserId: () => Effect.succeed([]),
      listPublishableByUserIds: () => Effect.succeed([]),
      findByIdForUser: () => Effect.die('not used'),
      create: () => Effect.die('not used'),
      updateByIdForUser: () => Effect.die('not used'),
      softDeleteByIdForUser: () => Effect.die('not used')
    }),
    makeApprovalRepoTest({
      findCurrentByUserId: (userId) =>
        Effect.succeed({
          id: `approval-${userId}`,
          userId,
          status: 'approved',
          expiresAt: new Date('2099-01-01')
        } as never)
    }),
    makeTcDocumentRepoTest({
      ...emptyTcDocumentRepo,
      findServiceAgreement: () =>
        Effect.succeed(
          options.templates === null
            ? null
            : {
                document: agreementDoc,
                versions: [...(options.templates ?? [templateRow()])].sort(
                  (a, b) => b.version - a.version
                )
              }
        ),
      findActiveBySlug: (slug) =>
        slug === 'terms_of_service'
          ? Effect.succeed(termsDoc)
          : Effect.fail(new DBNotFoundError({ entity: 'tcDocument', value: slug })),
      listVersions: (documentId) => Effect.succeed(documentId === 'tos-doc' ? [tosRow] : [])
    }),
    makeContractAgreementRepoTest({
      listForContract: () => Effect.succeed(options.signatures ?? [])
    }),
    makeContractRepoTest({
      create: () => Effect.die('not used'),
      findById: () => Effect.succeed(options.contract ?? contract()),
      findByConversationId: () => Effect.die('not used'),
      findWithContext: () => Effect.die('not used'),
      listForUser: () => Effect.die('not used'),
      listVersions: () => Effect.succeed(options.versions ?? [draft()]),
      createVersion: () => Effect.die('not used'),
      updateVersionTerms: () => Effect.die('not used'),
      sendPendingVersion: (_contractId, versionId, terms, signature) => {
        options.recorded?.sent.push(signature);
        return Effect.succeed(proposed({ id: versionId, ...terms }));
      },
      withdrawPendingVersion: () => Effect.die('not used'),
      acceptPendingVersion: (_contractId, versionId, acceptOptions) => {
        options.recorded?.accepted.push(acceptOptions.signature);
        return Effect.succeed(proposed({ id: versionId, status: 'accepted' }));
      },
      decidePendingVersion: () => Effect.die('not used'),
      setEnding: () => Effect.die('not used'),
      markSeen: () => Effect.void
    }),
    makeNotificationHubTest({ publish: () => Effect.void, subscribe: () => Effect.die('not used') })
  );
};

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

const makeContext = (id: string = CONTRACT_ID) =>
  ({
    req: { param: (key: string) => (key === 'id' ? id : undefined), json: async () => undefined },
    get: () => 'en'
  }) as unknown as HonoContext<HonoEnv>;

const toSign = (layer: ReturnType<typeof makeLayer>, viewer: User, locale: 'en' | 'fr' = 'en') =>
  Effect.runPromise(
    getAgreementToSignProgram(signedIn(viewer), CONTRACT_ID, locale).pipe(Effect.provide(layer))
  );

// ---------------------------------------------------------------------------

describe('agreementValues', () => {
  const input: AgreementValuesInput = {
    locale: 'en',
    templateVersion: 2,
    contractId: CONTRACT_ID,
    terms: {
      version: 3,
      services,
      startsOn: '2099-01-05',
      endsOn: null,
      endsAtMinutes: null,
      timeZone: WPG
    },
    family: { name: 'Priya Tester', city: 'Winnipeg', province: 'MB' },
    helper: { name: 'Maria Tester', city: null, province: 'MB' },
    pricing: {
      serviceCents: 10400,
      careTaxes: [],
      feeCents: 520,
      feeTaxes: [{ label: 'GST', taxCents: 26 }],
      commissionCents: 1560,
      commissionTaxes: [{ label: 'GST', taxCents: 78 }]
    },
    familyFeeBps: 500,
    providerCommissionBps: 1500,
    retryHours: 12,
    holdLeadHours: 48,
    cancellationPolicy: { title: 'Terms of Service', version: 3, publishedAt: at }
  };

  it('fills parties, services, the sorted weekly schedule and both sides of the money', () => {
    const values = agreementValues(input);
    expect(values).toMatchObject({
      'agreement.version': '2',
      'contract.version': '3',
      'contract.startsOn': 'Monday, January 5, 2099',
      'contract.hasEndDate': false,
      'family.location': 'Winnipeg, MB',
      // No city: the location is just the province, never ", MB".
      'helper.location': 'MB',
      'fees.weeklyCare': '$104.00',
      'fees.familyFeePercent': '5%',
      'fees.familyFee': '$5.20',
      'fees.familyFeeTaxes': [{ label: 'GST', amount: '$0.26' }],
      'fees.familyWeeklyTotal': '$109.46',
      'fees.commissionPercent': '15%',
      'fees.helperWeeklyShare': '$87.62',
      'billing.cycleDays': '3',
      'billing.holdLeadHours': '48',
      'notice.days': '14',
      'cancellation.policyVersion': '3'
    });
    expect(values.services).toEqual([
      expect.objectContaining({
        name: 'Childcare',
        rate: '$26.00',
        weeklyHours: '4',
        weeklyAmount: '$104.00',
        hasExpectations: true,
        sessions: [
          { day: 'Tuesday', start: '3:30 p.m.', end: '5:30 p.m.', hours: '2' },
          { day: 'Thursday', start: '3:30 p.m.', end: '5:30 p.m.', hours: '2' }
        ]
      })
    ]);
    expect((values.schedule as Array<{ day: string }>).map((row) => row.day)).toEqual([
      'Tuesday',
      'Thursday'
    ]);
  });

  it('formats in French, with the end of the last day when no end time was agreed', () => {
    const values = agreementValues({
      ...input,
      locale: 'fr',
      terms: { ...input.terms, endsOn: '2099-06-26' }
    });
    expect(values['contract.startsOn']).toBe('lundi 5 janvier 2099');
    expect(values['contract.hasEndDate']).toBe(true);
    expect(values['contract.endsAt']).toBe('la fin de la journée');
    expect(values['fees.familyFeePercent']).toMatch(/^5\s%$/);
  });

  it('states the extra-session settings for the v2 consent clause (Tier 3 step 3)', () => {
    expect(agreementValues(input)).toMatchObject({
      'billing.extraSessionDelayMinutes': '60',
      'billing.extraSessionLookbackDays': '14',
      'billing.extraSessionResponseHours': '48'
    });
    expect(
      agreementValues({
        ...input,
        extraSessions: { delayMinutes: 30, lookbackDays: 7, responseHours: 24 }
      })
    ).toMatchObject({
      'billing.extraSessionDelayMinutes': '30',
      'billing.extraSessionLookbackDays': '7',
      'billing.extraSessionResponseHours': '24'
    });
  });
});

describe('GET /contracts/:id/agreement (the agreement to sign)', () => {
  it("renders the family's draft in their zone, with its hash", async () => {
    const { agreement } = await toSign(makeLayer(), family);
    expect(agreement).toMatchObject({
      side: 'family',
      contractVersion: 1,
      versionId: 'agreement-v1-en',
      version: 1,
      locale: 'en',
      fallback: false,
      cancellationPolicyVersion: 3
    });
    expect(agreement.content).toBe(
      'Between Priya Tester (Winnipeg, MB) and Maria Tester (Brandon, MB).\n' +
        '- Childcare at $26.00/h\n' +
        'Starts Monday, January 5, 2099. Policy v3.'
    );
    expect(agreement.sha256).toBe(sha256Hex(agreement.content));
  });

  it('shows the French translation when published, else English with a notice', async () => {
    const french = templateRow({
      id: 'agreement-v1-fr',
      locale: 'fr',
      content: 'Entre {{family.name}}.'
    });
    const translated = await toSign(
      makeLayer({ templates: [templateRow(), french] }),
      family,
      'fr'
    );
    expect(translated.agreement).toMatchObject({ versionId: 'agreement-v1-fr', fallback: false });
    expect(translated.agreement.content).toBe('Entre Priya Tester.');
    const untranslated = await toSign(makeLayer(), family, 'fr');
    expect(untranslated.agreement).toMatchObject({ versionId: 'agreement-v1-en', fallback: true });
  });

  it('gives the helper the template revision the family signed, even after a new one', async () => {
    const layer = makeLayer({
      contract: contract({ status: 'proposed' }),
      versions: [proposed()],
      templates: [templateRow(), templateRow({ id: 'agreement-v2-en', version: 2, content: 'v2' })],
      signatures: [
        dummyContractAgreementSignature({
          contractId: CONTRACT_ID,
          contractVersionId: 'version-1',
          templateVersionId: 'agreement-v1-en',
          templateVersion: 1
        })
      ]
    });
    const { agreement } = await toSign(layer, helper);
    expect(agreement).toMatchObject({ side: 'helper', versionId: 'agreement-v1-en', version: 1 });
  });

  it('hides the contract from outsiders and the helper while it is a family draft', async () => {
    for (const viewer of [outsider, helper]) {
      const exit = await Effect.runPromiseExit(
        getAgreementToSignProgram(signedIn(viewer), CONTRACT_ID, 'en').pipe(
          Effect.provide(makeLayer({ viewer }))
        )
      );
      expect(getFailure(exit)).toMatchObject({ _tag: 'ContractNotFoundError' });
    }
  });

  it('has nothing to sign for the family once the terms are sent', async () => {
    const exit = await Effect.runPromiseExit(
      getAgreementToSignProgram(signedIn(family), CONTRACT_ID, 'en').pipe(
        Effect.provide(
          makeLayer({ contract: contract({ status: 'proposed' }), versions: [proposed()] })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
  });

  it('is unavailable without a published template, or with one naming unknown placeholders', async () => {
    const none = await Effect.runPromiseExit(
      getAgreementToSignProgram(signedIn(family), CONTRACT_ID, 'en').pipe(
        Effect.provide(makeLayer({ templates: null }))
      )
    );
    expect(getFailure(none)).toMatchObject({
      _tag: 'AgreementUnavailableError',
      reason: 'no_template'
    });
    const invalid = await Effect.runPromiseExit(
      getAgreementToSignProgram(signedIn(family), CONTRACT_ID, 'en').pipe(
        Effect.provide(makeLayer({ templates: [templateRow({ content: '{{family.nmae}}' })] }))
      )
    );
    expect(getFailure(invalid)).toMatchObject({
      _tag: 'AgreementUnavailableError',
      reason: 'template_invalid'
    });
  });
});

describe('signing the agreement with Sign & send and Accept & sign', () => {
  const assentFrom = async (layer: ReturnType<typeof makeLayer>, viewer: User) => {
    const { agreement } = await toSign(layer, viewer);
    return { versionId: agreement.versionId, sha256: agreement.sha256, content: agreement.content };
  };

  it("records the family's signature with the exact text, its hash and the policy in force", async () => {
    const recorded: Recorded = { sent: [], accepted: [] };
    const layer = makeLayer({ recorded });
    const assent = await assentFrom(layer, family);
    await Effect.runPromise(
      sendContractProgram(signedIn(family), CONTRACT_ID, assent).pipe(Effect.provide(layer))
    );
    expect(recorded.sent).toEqual([
      {
        signerUserId: 'family-1',
        signerSide: 'family',
        templateDocumentId: 'agreement-doc',
        templateVersionId: 'agreement-v1-en',
        templateVersion: 1,
        locale: 'en',
        content: assent.content,
        contentSha256: sha256Hex(assent.content),
        cancellationPolicyVersionId: 'tos-v3',
        cancellationPolicyVersion: 3
      }
    ]);
  });

  it('refuses a stale text, or a template revision published while reading, and sends nothing', async () => {
    const recorded: Recorded = { sent: [], accepted: [] };
    const assent = await assentFrom(makeLayer(), family);
    const stale = await Effect.runPromiseExit(
      sendContractProgram(signedIn(family), CONTRACT_ID, {
        ...assent,
        sha256: sha256Hex('something else')
      }).pipe(Effect.provide(makeLayer({ recorded })))
    );
    expect(getFailure(stale)).toMatchObject({ _tag: 'AgreementChangedError' });
    const republished = await Effect.runPromiseExit(
      sendContractProgram(signedIn(family), CONTRACT_ID, assent).pipe(
        Effect.provide(
          makeLayer({
            recorded,
            templates: [templateRow(), templateRow({ id: 'agreement-v2-en', version: 2 })]
          })
        )
      )
    );
    expect(getFailure(republished)).toMatchObject({ _tag: 'AgreementChangedError' });
    expect(recorded.sent).toEqual([]);
  });

  it('refuses to sign for a member while impersonating them', async () => {
    const recorded: Recorded = { sent: [], accepted: [] };
    const assent = await assentFrom(makeLayer(), family);
    const send = await Effect.runPromiseExit(
      sendContractProgram(signedIn(family, 'admin-1'), CONTRACT_ID, assent).pipe(
        Effect.provide(makeLayer({ recorded }))
      )
    );
    expect(getFailure(send)).toMatchObject({ _tag: 'AgreementImpersonationError' });

    const proposal = { contract: contract({ status: 'proposed' }), versions: [proposed()] };
    const helperAssent = await assentFrom(makeLayer({ ...proposal, viewer: helper }), helper);
    const accept = await Effect.runPromiseExit(
      acceptContractProgram(signedIn(helper, 'admin-1'), CONTRACT_ID, helperAssent).pipe(
        Effect.provide(makeLayer({ ...proposal, viewer: helper, recorded }))
      )
    );
    expect(getFailure(accept)).toMatchObject({ _tag: 'AgreementImpersonationError' });
    expect(recorded).toEqual({ sent: [], accepted: [] });
  });

  it("records the helper's signature on the same contract version, in the family's revision", async () => {
    const recorded: Recorded = { sent: [], accepted: [] };
    const options = {
      viewer: helper,
      contract: contract({ status: 'proposed' as const }),
      versions: [proposed()],
      templates: [templateRow(), templateRow({ id: 'agreement-v2-en', version: 2, content: 'v2' })],
      signatures: [
        dummyContractAgreementSignature({
          contractId: CONTRACT_ID,
          contractVersionId: 'version-1',
          templateVersion: 1
        })
      ],
      recorded
    };
    const assent = await assentFrom(makeLayer(options), helper);
    await Effect.runPromise(
      acceptContractProgram(signedIn(helper), CONTRACT_ID, assent).pipe(
        Effect.provide(makeLayer(options))
      )
    );
    expect(recorded.accepted).toEqual([
      expect.objectContaining({
        signerUserId: 'provider-1',
        signerSide: 'helper',
        templateVersionId: 'agreement-v1-en',
        templateVersion: 1,
        contentSha256: assent.sha256
      })
    ]);
  });
});

describe('GET /contracts/:id/agreement/signed', () => {
  const familyV1 = dummyContractAgreementSignature({
    id: 'sig-family-old',
    contractId: CONTRACT_ID,
    contractVersionId: 'version-1',
    signedAt: new Date('2026-10-20T00:00:00.000Z'),
    // The family withdrew to edit: this signature no longer counts.
    voidedAt: new Date('2026-10-21T00:00:00.000Z')
  });
  const familyResent = dummyContractAgreementSignature({
    id: 'sig-family',
    contractId: CONTRACT_ID,
    contractVersionId: 'version-1',
    content: 'Signed text',
    signedAt: new Date('2026-10-22T00:00:00.000Z')
  });
  const helperSigned = dummyContractAgreementSignature({
    id: 'sig-helper',
    contractId: CONTRACT_ID,
    contractVersionId: 'version-1',
    signerUserId: 'provider-1',
    signerSide: 'helper',
    content: 'Signed text',
    signedAt: new Date('2026-10-23T00:00:00.000Z')
  });
  const signedContract = {
    contract: contract({ status: 'active' as const }),
    versions: [proposed({ status: 'accepted' })],
    signatures: [familyV1, familyResent, helperSigned]
  };

  const view = (options: Parameters<typeof makeLayer>[0]) =>
    Effect.runPromiseExit(
      getSignedAgreementRouteProgram(makeContext(), new Headers()).pipe(
        Effect.provide(makeLayer(options))
      )
    );

  it('shows both parties who signed which text when, and that a re-sent signature replaced the old one', async () => {
    for (const viewer of [family, helper]) {
      const exit = await view({ ...signedContract, viewer });
      if (!Exit.isSuccess(exit)) throw new Error('expected success');
      const { agreement } = exit.value;
      expect(agreement.contractVersion).toBe(1);
      expect(
        agreement.signatures.map((signature) => [signature.id, signature.side, signature.counts])
      ).toEqual([
        ['sig-helper', 'helper', true],
        ['sig-family', 'family', true],
        ['sig-family-old', 'family', false]
      ]);
      expect(agreement.signatures[0]).toMatchObject({
        signerName: 'Maria Tester',
        content: 'Signed text',
        templateVersion: 1,
        signedAt: '2026-10-23T00:00:00.000Z'
      });
    }
  });

  it('does not count a signature on terms that were declined and replaced', async () => {
    const exit = await view({
      contract: contract({ status: 'proposed' }),
      versions: [
        proposed({ id: 'version-1', status: 'declined' }),
        proposed({ id: 'version-2', version: 2 })
      ],
      signatures: [familyResent]
    });
    if (!Exit.isSuccess(exit)) throw new Error('expected success');
    expect(exit.value.agreement.contractVersion).toBe(2);
    expect(exit.value.agreement.signatures[0]?.counts).toBe(false);
  });

  it('is hidden from outsiders, but open to an admin holding contract review', async () => {
    const denied = await view({ ...signedContract, viewer: outsider });
    expect(getFailure(denied)).toMatchObject({ _tag: 'ContractNotFoundError' });
    const reviewed = await view({ ...signedContract, viewer: admin, reviewer: true });
    expect(Exit.isSuccess(reviewed)).toBe(true);
  });

  it('is hidden from the helper while the contract is a family draft', async () => {
    const exit = await view({ viewer: helper, contract: contract({ status: 'draft' }) });
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractNotFoundError' });
  });
});
