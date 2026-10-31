/**
 * The ready-made UAT accounts, shared by the local dev fixture
 * (apps/worker/src/dev/billing-fixture.ts, `docker compose up` dev-fixtures)
 * and the staging UAT step (./run.ts, run by scripts/run-seeds.sh after the
 * tracked seeds). Idempotent: every row is matched by its natural key (users
 * by email) and reused.
 *
 * Creates (or reuses) users who can create, send and accept a contract with
 * each other right away:
 *
 *   - Fiona   family, Toronto ON
 *   - Hana    service-provider, Winnipeg MB, "Childcare" at $25/h, with an
 *             ACTIVE conversation with Fiona
 *
 * each with a profile, a live approval (approved by the first seeded admin),
 * a VERIFIED uploaded-document safety verification (issued today, valid one
 * year — never a check order or payment, nothing reaches Credibled) and
 * acceptance of every published T&C version for their role (the service
 * agreement included); plus a "Childcare" need for Fiona.
 *
 * `replacementHelpers` adds three approved helpers in Toronto for Fiona to
 * try as a replacement for Hana:
 *
 *   - Robin  Childcare at $30/h, NO conversation (the reach-out-first path);
 *   - Theo   Tutoring only, with an ACTIVE conversation
 *            (REPLACEMENT_SERVICE_NOT_OFFERED);
 *   - Paula  Pet Minding plus a custom "Childcare" still pending review, with
 *            an ACTIVE conversation (REPLACEMENT_SERVICE_NOT_AVAILABLE).
 *
 * `accountant` adds the accountant (tax portal, books).
 *
 * Addresses: the historical @example.test ones, or — with `emailBase`
 * (UAT_EMAIL_BASE, e.g. kay@poppynz.com) — plus-addresses of it
 * (kay+fiona@…, kay+hana@…, kay+robin@…, kay+theo@…, kay+paula@…,
 * kay+accountant@…), so magic links reach a real mailbox on staging.
 *
 * `payoutAccountReference` (acct_…) upserts Hana's Stripe payout account in
 * `onboarding` with `refreshed_at = NULL`, so the API re-fetches its real
 * status from Stripe on first use. Without it payout accounts are left alone.
 * Never creates cards, billing customers, contracts or payments.
 *
 * Restart the worker afterwards (it rebuilds the search index on boot) so the
 * helpers appear in Find help; on dokploy the worker starts after the seeds.
 * Must run in UTC (TZ=UTC): `date` columns carry no zone.
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';
import * as schema from '@repo/db/schema';
import { uatEmail } from '@repo/env';
import type { SeederDb } from '../types';

type Role = 'family' | 'service-provider';

export type FixtureUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  profile: {
    firstName: string;
    lastName: string;
    phoneNumber: string;
    address: string;
    city: string;
    postalCode: string;
    stateProvince: string;
    latitude: number;
    longitude: number;
    shortBio: string;
  };
};

type ExtraService = {
  name: string;
  /** The catalogue item it lists, by name; null for a custom service. */
  catalogueName: string | null;
  rateCents: number;
  reviewStatus: 'approved' | 'pending';
};

export type ReplacementHelper = {
  user: FixtureUser;
  services: Array<ExtraService>;
  conversation: boolean;
};

export type UatAccountant = { id: string; email: string; name: string };

export type UatFixtureUsers = {
  family: FixtureUser;
  helper: FixtureUser;
  replacements: Array<ReplacementHelper>;
  accountant: UatAccountant;
};

const torontoProfile = (firstName: string, lastName: string, phone: string, address: string) => ({
  firstName,
  lastName,
  phoneNumber: phone,
  address,
  city: 'Toronto',
  postalCode: 'M5V 2T6',
  stateProvince: 'ON',
  latitude: 43.6426,
  longitude: -79.3871,
  shortBio: `UAT replacement helper (${firstName}).`
});

/** The historical addresses (and fixed ids) of the dev fixture. */
const DEFAULT_ADDRESSES = {
  fiona: { id: 'dev-billing-family', email: 'billing-family@example.test' },
  hana: { id: 'dev-billing-helper', email: 'billing-helper@example.test' },
  robin: { id: 'dev-replacement-helper', email: 'replacement-helper@example.test' },
  theo: { id: 'dev-replacement-tutor', email: 'replacement-tutor@example.test' },
  paula: { id: 'dev-replacement-pending', email: 'replacement-pending@example.test' },
  accountant: { id: 'dev-uat-accountant', email: 'accountant@example.test' }
} as const;

type Alias = keyof typeof DEFAULT_ADDRESSES;

/**
 * Each account's id and email. Users are upserted by email, so an existing
 * account keeps its id; a NEW account takes this id. With a base address the
 * id is derived from the email — a fixed id would collide (primary key) with
 * the account of a previous base once the base changes.
 */
export const uatAddress = (alias: Alias, emailBase: string | null | undefined) => {
  if (!emailBase) return DEFAULT_ADDRESSES[alias];
  const email = uatEmail(emailBase, alias);
  if (!email) throw new Error(`UAT_EMAIL_BASE is not an email address: ${emailBase}`);
  return { id: `uat-${email}`, email };
};

export const uatFixtureUsers = (emailBase?: string | null): UatFixtureUsers => ({
  family: {
    ...uatAddress('fiona', emailBase),
    name: 'Fiona Family',
    role: 'family',
    profile: {
      firstName: 'Fiona',
      lastName: 'Family',
      phoneNumber: '+14165550101',
      address: '100 Queen St W',
      city: 'Toronto',
      postalCode: 'M5H 2N2',
      stateProvince: 'ON',
      latitude: 43.6532,
      longitude: -79.3832,
      shortBio: 'UAT family.'
    }
  },
  helper: {
    ...uatAddress('hana', emailBase),
    name: 'Hana Helper',
    role: 'service-provider',
    profile: {
      firstName: 'Hana',
      lastName: 'Helper',
      phoneNumber: '+12045550102',
      address: '510 Main St',
      city: 'Winnipeg',
      postalCode: 'R3B 1B9',
      stateProvince: 'MB',
      latitude: 49.8951,
      longitude: -97.1384,
      shortBio: 'UAT helper.'
    }
  },
  replacements: [
    {
      user: {
        ...uatAddress('robin', emailBase),
        name: 'Robin Replacement',
        role: 'service-provider',
        profile: torontoProfile('Robin', 'Replacement', '+14165550103', '290 Bremner Blvd')
      },
      services: [
        { name: 'Childcare', catalogueName: 'Childcare', rateCents: 3000, reviewStatus: 'approved' }
      ],
      conversation: false
    },
    {
      user: {
        ...uatAddress('theo', emailBase),
        name: 'Theo Tutor',
        role: 'service-provider',
        profile: torontoProfile('Theo', 'Tutor', '+14165550104', '1 Blue Jays Way')
      },
      services: [
        { name: 'Tutoring', catalogueName: 'Tutoring', rateCents: 2800, reviewStatus: 'approved' }
      ],
      conversation: true
    },
    {
      user: {
        ...uatAddress('paula', emailBase),
        name: 'Paula Pending',
        role: 'service-provider',
        profile: torontoProfile('Paula', 'Pending', '+14165550105', '40 Bay St')
      },
      services: [
        {
          name: 'Pet Minding',
          catalogueName: 'Pet Minding',
          rateCents: 2000,
          reviewStatus: 'approved'
        },
        { name: 'Childcare', catalogueName: null, rateCents: 2600, reviewStatus: 'pending' }
      ],
      conversation: true
    }
  ],
  accountant: { ...uatAddress('accountant', emailBase), name: 'accountant' }
});

export const SERVICE_NAME = 'Childcare';
export const HOURLY_RATE_CENTS = 2500;

export const isPayoutAccountReference = (value: string | null | undefined) =>
  /^acct_\w+$/.test(value ?? '');

export type UatFixtureOptions = {
  /** UAT_EMAIL_BASE; null keeps the @example.test addresses. */
  emailBase?: string | null;
  /** UAT_HELPER_PAYOUT_ACCOUNT / --payout-account: Hana's acct_… */
  payoutAccountReference?: string | null;
  replacementHelpers: boolean;
  accountant: boolean;
  now?: Date;
};

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

/** Creates or reuses every UAT account; resolves the report lines to print. */
export const runUatFixtures = async (
  db: SeederDb,
  options: UatFixtureOptions
): Promise<Array<string>> => {
  if (options.payoutAccountReference && !isPayoutAccountReference(options.payoutAccountReference)) {
    throw new Error('the helper payout account must be a Stripe account id (acct_…)');
  }
  const users = uatFixtureUsers(options.emailBase);
  const FAMILY = users.family;
  const HELPER = users.helper;
  const now = options.now ?? new Date();
  const today = toDateOnly(now);
  const inOneYear = new Date(now);
  inOneYear.setUTCFullYear(inOneYear.getUTCFullYear() + 1);

  const upsertUser = async (fixture: FixtureUser) => {
    const [row] = await db
      .insert(schema.user)
      .values({
        id: fixture.id,
        name: fixture.name,
        email: fixture.email,
        emailVerified: true,
        role: fixture.role
      })
      .onConflictDoUpdate({
        target: schema.user.email,
        set: { name: fixture.name, emailVerified: true, role: fixture.role }
      })
      .returning({ id: schema.user.id });
    if (!row) throw new Error(`could not upsert user ${fixture.email}`);
    const userId = row.id;

    const profile = { ...fixture.profile, language: 'en', country: 'CA' };
    await db
      .insert(schema.userProfile)
      .values({ userId, ...profile })
      .onConflictDoUpdate({ target: schema.userProfile.userId, set: profile });

    return userId;
  };

  const ensureApproval = async (userId: string, adminId: string) => {
    const [live] = await db
      .select({ id: schema.approval.id })
      .from(schema.approval)
      .where(
        and(
          eq(schema.approval.userId, userId),
          eq(schema.approval.status, 'approved'),
          gt(schema.approval.expiresAt, now)
        )
      )
      .limit(1);
    if (live) return 'reused';

    await db.transaction(async (tx) => {
      const [request] = await tx
        .insert(schema.approvalRequest)
        .values({ userId, status: 'approved', reviewedBy: adminId, reviewedAt: now })
        .returning({ id: schema.approvalRequest.id });
      if (!request) throw new Error('could not create approval request');
      await tx.insert(schema.approval).values({
        userId,
        approvalRequestId: request.id,
        approvedBy: adminId,
        status: 'approved',
        reason: 'UAT fixture',
        expiresAt: inOneYear
      });
    });
    return 'created';
  };

  const ensureSafetyVerification = async (userId: string, role: Role, adminId: string) => {
    const verdict = {
      status: 'verified' as const,
      reviewedBy: adminId,
      reviewedAt: now,
      decisionReason: 'UAT fixture',
      issuedOn: today,
      expiresOn: toDateOnly(inOneYear)
    };
    // The live slot (one per user and role): anything not rejected or expired.
    const [live] = await db
      .select()
      .from(schema.safetyVerification)
      .where(
        and(
          eq(schema.safetyVerification.userId, userId),
          eq(schema.safetyVerification.role, role),
          isNull(schema.safetyVerification.deletedAt),
          notInArray(schema.safetyVerification.status, ['rejected', 'expired'])
        )
      )
      .limit(1);

    if (live) {
      if (live.status === 'verified' && live.expiresOn !== null && live.expiresOn > today) {
        return 'reused';
      }
      await db
        .update(schema.safetyVerification)
        .set(verdict)
        .where(eq(schema.safetyVerification.id, live.id));
      return 'updated';
    }

    await db.insert(schema.safetyVerification).values({
      userId,
      role,
      route: 'uploaded_document',
      issuingAuthority: 'UAT fixture police service',
      documentNumber: `UAT-${userId}`,
      filename: 'uat-fixture-vulnerable-sector-check.pdf',
      ...verdict
    });
    return 'created';
  };

  const acceptPublishedTcs = async (userId: string, role: Role) => {
    const published = await db
      .select({
        documentId: schema.tcDocument.id,
        slug: schema.tcDocument.slug,
        versionId: schema.tcDocumentVersion.id,
        version: schema.tcDocumentVersion.version
      })
      .from(schema.tcDocumentVersion)
      .innerJoin(schema.tcDocument, eq(schema.tcDocument.id, schema.tcDocumentVersion.documentId))
      .where(
        and(
          isNull(schema.tcDocument.deletedAt),
          isNotNull(schema.tcDocumentVersion.publishedAt),
          inArray(schema.tcDocument.appliesToRole, ['all', role])
        )
      )
      .orderBy(asc(schema.tcDocument.slug), desc(schema.tcDocumentVersion.version));

    // Latest published version per document.
    const latest = new Map<string, (typeof published)[number]>();
    for (const row of published) {
      if (!latest.has(row.documentId)) latest.set(row.documentId, row);
    }
    if (latest.size === 0) return [];

    await db
      .insert(schema.tcDocumentAcceptance)
      .values([...latest.values()].map((row) => ({ userId, ...row })))
      .onConflictDoNothing();
    return [...latest.values()].map((row) => `${row.slug}@v${row.version}`);
  };

  const findCatalogueItemId = async (name: string) => {
    const [row] = await db
      .select({ id: schema.serviceCatalogueItem.id })
      .from(schema.serviceCatalogueItem)
      .where(
        and(
          eq(schema.serviceCatalogueItem.name, name),
          isNull(schema.serviceCatalogueItem.deletedAt)
        )
      )
      .limit(1);
    return row?.id ?? null;
  };

  const ensureService = async (
    userId: string,
    service: ExtraService,
    description: string
  ): Promise<string> => {
    const catalogueServiceId = service.catalogueName
      ? await findCatalogueItemId(service.catalogueName)
      : null;
    const [existing] = await db
      .select({ id: schema.serviceOffered.id })
      .from(schema.serviceOffered)
      .where(
        and(
          eq(schema.serviceOffered.userId, userId),
          eq(schema.serviceOffered.name, service.name),
          isNull(schema.serviceOffered.deletedAt)
        )
      )
      .limit(1);
    if (existing) return existing.id;
    const [created] = await db
      .insert(schema.serviceOffered)
      .values({
        userId,
        catalogueServiceId,
        name: service.name,
        description,
        hourlyRateCents: service.rateCents,
        currency: 'CAD',
        reviewStatus: service.reviewStatus
      })
      .returning({ id: schema.serviceOffered.id });
    if (!created) throw new Error(`could not create service ${service.name}`);
    return created.id;
  };

  const ensureServiceNeeded = async (userId: string, catalogueServiceId: string | null) => {
    const [existing] = await db
      .select({ id: schema.serviceNeeded.id })
      .from(schema.serviceNeeded)
      .where(
        and(
          eq(schema.serviceNeeded.userId, userId),
          eq(schema.serviceNeeded.name, SERVICE_NAME),
          isNull(schema.serviceNeeded.deletedAt)
        )
      )
      .limit(1);
    if (existing) return existing.id;

    const [created] = await db
      .insert(schema.serviceNeeded)
      .values({
        userId,
        catalogueServiceId,
        name: SERVICE_NAME,
        description: 'After-school childcare (UAT fixture).'
      })
      .returning({ id: schema.serviceNeeded.id });
    if (!created) throw new Error('could not create service needed');
    return created.id;
  };

  const ensureActiveConversation = async (
    familyUserId: string,
    providerUserId: string,
    serviceOfferedId: string,
    service: { name: string; firstName: string }
  ) => {
    const [existing] = await db
      .select()
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.familyUserId, familyUserId),
          eq(schema.conversation.providerUserId, providerUserId),
          isNull(schema.conversation.deletedAt)
        )
      )
      .limit(1);

    if (existing) {
      if (existing.status !== 'active') {
        await db
          .update(schema.conversation)
          .set({ status: 'active', respondedAt: now, ignoredAt: null })
          .where(eq(schema.conversation.id, existing.id));
      }
      return existing.id;
    }

    const [created] = await db
      .insert(schema.conversation)
      .values({
        familyUserId,
        providerUserId,
        initiatorUserId: familyUserId,
        status: 'active',
        reachoutMessage: `Hi ${service.firstName}, we are looking for some help. (UAT fixture)`,
        reachoutServices: [{ serviceId: serviceOfferedId, name: service.name }],
        respondedAt: now
      })
      .returning({ id: schema.conversation.id });
    if (!created) throw new Error('could not create conversation');
    return created.id;
  };

  const upsertPayoutAccount = async (userId: string, accountReference: string) => {
    const values = {
      provider: 'stripe',
      accountReference,
      status: 'onboarding' as const,
      detailsSubmitted: false,
      payoutsEnabled: false,
      transfersActive: false,
      requirementsDue: [],
      disabledReason: null,
      refreshedAt: null
    };
    await db
      .insert(schema.payoutAccount)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: schema.payoutAccount.userId, set: values });
  };

  const [admin] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.role, 'admin'))
    .orderBy(asc(schema.user.createdAt))
    .limit(1);
  if (!admin) {
    throw new Error('no admin user found — run the seeds first (0000_admin_users)');
  }

  // Refuse to adopt an existing account of another role under a fixture email.
  const expectedRoles = new Map<string, string>([
    [FAMILY.email, FAMILY.role],
    [HELPER.email, HELPER.role],
    ...(options.replacementHelpers
      ? users.replacements.map((extra) => [extra.user.email, extra.user.role] as [string, string])
      : []),
    ...(options.accountant ? [[users.accountant.email, 'accountant'] as [string, string]] : [])
  ]);
  const existing = await db
    .select({ email: schema.user.email, role: schema.user.role })
    .from(schema.user)
    .where(inArray(schema.user.email, [...expectedRoles.keys()]));
  for (const row of existing) {
    const expected = expectedRoles.get(row.email);
    if (row.role !== null && row.role !== expected) {
      throw new Error(`${row.email} already exists with role ${row.role}; expected ${expected}`);
    }
  }

  const familyId = await upsertUser(FAMILY);
  const helperId = await upsertUser(HELPER);

  const approvals = {
    family: await ensureApproval(familyId, admin.id),
    helper: await ensureApproval(helperId, admin.id)
  };
  const safety = {
    family: await ensureSafetyVerification(familyId, FAMILY.role, admin.id),
    helper: await ensureSafetyVerification(helperId, HELPER.role, admin.id)
  };
  const tcs = {
    family: await acceptPublishedTcs(familyId, FAMILY.role),
    helper: await acceptPublishedTcs(helperId, HELPER.role)
  };

  const catalogueId = await findCatalogueItemId(SERVICE_NAME);
  const serviceOfferedId = await ensureService(
    helperId,
    {
      name: SERVICE_NAME,
      catalogueName: SERVICE_NAME,
      rateCents: HOURLY_RATE_CENTS,
      reviewStatus: 'approved'
    },
    'After-school childcare (UAT fixture).'
  );
  await ensureServiceNeeded(familyId, catalogueId);
  const conversationId = await ensureActiveConversation(familyId, helperId, serviceOfferedId, {
    name: SERVICE_NAME,
    firstName: HELPER.profile.firstName
  });

  if (options.payoutAccountReference) {
    await upsertPayoutAccount(helperId, options.payoutAccountReference);
  }

  const extras: Array<string> = [];
  if (options.replacementHelpers) {
    for (const extra of users.replacements) {
      const extraId = await upsertUser(extra.user);
      await ensureApproval(extraId, admin.id);
      await ensureSafetyVerification(extraId, extra.user.role, admin.id);
      await acceptPublishedTcs(extraId, extra.user.role);
      const serviceIds: Array<string> = [];
      for (const service of extra.services) {
        serviceIds.push(
          await ensureService(extraId, service, `${service.name} (UAT replacement helper).`)
        );
      }
      const conversation = extra.conversation
        ? await ensureActiveConversation(familyId, extraId, serviceIds[0]!, {
            name: extra.services[0]!.name,
            firstName: extra.user.profile.firstName
          })
        : null;
      extras.push(
        `  ${extra.user.email}  id=${extraId}  services=[${extra.services
          .map((service) => `${service.name} ${service.rateCents} ${service.reviewStatus}`)
          .join(', ')}]  conversation=${conversation ?? 'none'}`
      );
    }
  }

  let accountantLine: string | null = null;
  if (options.accountant) {
    const [row] = await db
      .insert(schema.user)
      .values({
        id: users.accountant.id,
        name: users.accountant.name,
        email: users.accountant.email,
        emailVerified: true,
        role: 'accountant'
      })
      .onConflictDoUpdate({
        target: schema.user.email,
        set: { emailVerified: true, role: 'accountant' }
      })
      .returning({ id: schema.user.id });
    accountantLine = `  accountant  ${users.accountant.email}  id=${row?.id ?? '?'}`;
  }

  return [
    `  family  ${FAMILY.email}  id=${familyId}`,
    `  helper  ${HELPER.email}  id=${helperId}`,
    `  conversation (active)  id=${conversationId}`,
    `  helper service  ${SERVICE_NAME} ${HOURLY_RATE_CENTS} CAD cents/h  id=${serviceOfferedId}`,
    `  approvals  family=${approvals.family} helper=${approvals.helper}`,
    `  safety verifications  family=${safety.family} helper=${safety.helper}`,
    `  T&Cs accepted  family=[${tcs.family.join(', ')}] helper=[${tcs.helper.join(', ')}]`,
    options.payoutAccountReference
      ? '  helper payout account  upserted (onboarding, refreshed on first use)'
      : '  helper payout account  untouched (no acct_… given)',
    ...(extras.length > 0
      ? ['  replacement helpers (the worker indexes them on boot):', ...extras]
      : []),
    ...(accountantLine ? [accountantLine] : [])
  ];
};
