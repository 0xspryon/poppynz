/**
 * DEV ONLY — prepares a local database so a human can exercise contract
 * billing in the browser (web on http://localhost:5173, API on :3000, Stripe
 * TEST mode). Idempotent: rerunning reuses every row it created.
 *
 * From the host (worktree root, docker Postgres published on localhost):
 *
 *   TZ=UTC ENVIRONMENT=dev BILLING_DEV_CLOCK=enabled \
 *     DATABASE_URL=postgres://user:pass@localhost:5432/poppynz_dev \
 *     bun apps/worker/src/dev/billing-fixture.ts [--payout-account acct_…]
 *
 * Inside the worker container:
 *
 *   docker compose exec worker sh -c 'cd /usr/src/app && ENVIRONMENT=dev \
 *     BILLING_DEV_CLOCK=enabled bun apps/worker/src/dev/billing-fixture.ts'
 *
 * Creates (or reuses, matched by email) two users who can create, send and
 * accept a contract with each other right away:
 *
 *   - billing-family@example.test  (family, Toronto ON)
 *   - billing-helper@example.test  (service-provider, Winnipeg MB)
 *
 * with, for each: a profile, a live approval (approved by the first seeded
 * admin), a VERIFIED uploaded-document safety verification (issued today,
 * valid one year — never a check order or payment, nothing reaches
 * Credibled) and acceptance of every published T&C version for their role;
 * plus a "Childcare" service offered by the helper, a "Childcare" need for
 * the family and an ACTIVE family ↔ helper conversation.
 *
 * `--payout-account acct_…` also upserts the helper's Stripe payout account in
 * `onboarding` with `refreshed_at = NULL`, so the API re-fetches its real
 * status from Stripe on first use. Without the flag payout accounts are left
 * alone. Never creates cards, billing customers, contracts or payments.
 *
 * Sign-in is by magic link only: request one on the sign-in page; the link is
 * printed in the api logs (`docker logs api 2>&1 | grep 'Magic link for'`).
 */
import { requireDevClock } from './guard';

requireDevClock();

const ALLOWED_DB_HOSTS = new Set(['localhost', '127.0.0.1', 'postgres']);

const databaseHost = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    return null;
  }
})();
if (databaseHost === null || !ALLOWED_DB_HOSTS.has(databaseHost)) {
  console.error(
    '[dev-billing] DATABASE_URL must point at a local Postgres (localhost, 127.0.0.1 or postgres). Nothing was done.'
  );
  process.exit(1);
}

const argument = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const payoutAccountReference = argument('payout-account');
if (process.argv.includes('--payout-account') && !/^acct_\w+$/.test(payoutAccountReference ?? '')) {
  console.error(
    '[dev-billing] --payout-account expects a Stripe account id (acct_…). Nothing was done.'
  );
  process.exit(1);
}

// Imported only after the guards so nothing touches the database before them.
const { db } = await import('@repo/db');
const { and, asc, desc, eq, gt, inArray, isNotNull, isNull, notInArray, or } =
  await import('drizzle-orm');
const schema = await import('@repo/db/schema');

type Role = 'family' | 'service-provider';

type FixtureUser = {
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

const FAMILY: FixtureUser = {
  id: 'dev-billing-family',
  email: 'billing-family@example.test',
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
    shortBio: 'Dev billing fixture family.'
  }
};

const HELPER: FixtureUser = {
  id: 'dev-billing-helper',
  email: 'billing-helper@example.test',
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
    shortBio: 'Dev billing fixture helper.'
  }
};

const SERVICE_NAME = 'Childcare';
const HOURLY_RATE_CENTS = 2500;

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);
const now = new Date();
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
      reason: 'Dev billing fixture',
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
    decisionReason: 'Dev billing fixture',
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
    issuingAuthority: 'Dev fixture police service',
    documentNumber: `DEV-${userId}`,
    filename: 'dev-fixture-vulnerable-sector-check.pdf',
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
      and(eq(schema.serviceCatalogueItem.name, name), isNull(schema.serviceCatalogueItem.deletedAt))
    )
    .limit(1);
  return row?.id ?? null;
};

const ensureServiceOffered = async (userId: string, catalogueServiceId: string | null) => {
  const [existing] = await db
    .select({ id: schema.serviceOffered.id })
    .from(schema.serviceOffered)
    .where(
      and(
        eq(schema.serviceOffered.userId, userId),
        eq(schema.serviceOffered.name, SERVICE_NAME),
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
      name: SERVICE_NAME,
      description: 'After-school childcare (dev billing fixture).',
      hourlyRateCents: HOURLY_RATE_CENTS,
      currency: 'CAD'
    })
    .returning({ id: schema.serviceOffered.id });
  if (!created) throw new Error('could not create service offered');
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
      description: 'After-school childcare (dev billing fixture).'
    })
    .returning({ id: schema.serviceNeeded.id });
  if (!created) throw new Error('could not create service needed');
  return created.id;
};

const ensureActiveConversation = async (
  familyUserId: string,
  providerUserId: string,
  serviceOfferedId: string
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
      reachoutMessage: 'Hi Hana, we are looking for after-school childcare. (dev billing fixture)',
      reachoutServices: [{ serviceId: serviceOfferedId, name: SERVICE_NAME }],
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

try {
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
  const existing = await db
    .select({ email: schema.user.email, role: schema.user.role })
    .from(schema.user)
    .where(or(eq(schema.user.email, FAMILY.email), eq(schema.user.email, HELPER.email)));
  for (const row of existing) {
    const expected = row.email === FAMILY.email ? FAMILY.role : HELPER.role;
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
  const serviceOfferedId = await ensureServiceOffered(helperId, catalogueId);
  await ensureServiceNeeded(familyId, catalogueId);
  const conversationId = await ensureActiveConversation(familyId, helperId, serviceOfferedId);

  if (payoutAccountReference) {
    await upsertPayoutAccount(helperId, payoutAccountReference);
  }

  console.log('[dev-billing] fixture ready');
  console.log(`  family  ${FAMILY.email}  id=${familyId}`);
  console.log(`  helper  ${HELPER.email}  id=${helperId}`);
  console.log(`  conversation (active)  id=${conversationId}`);
  console.log(
    `  helper service  ${SERVICE_NAME} ${HOURLY_RATE_CENTS} CAD cents/h  id=${serviceOfferedId}`
  );
  console.log(`  approvals  family=${approvals.family} helper=${approvals.helper}`);
  console.log(`  safety verifications  family=${safety.family} helper=${safety.helper}`);
  console.log(
    `  T&Cs accepted  family=[${tcs.family.join(', ')}] helper=[${tcs.helper.join(', ')}]`
  );
  console.log(
    payoutAccountReference
      ? '  helper payout account  upserted (onboarding, refreshed on first use)'
      : '  helper payout account  untouched (pass --payout-account acct_… to set one)'
  );
  console.log(
    "  sign in: request a magic link on the sign-in page; the link is printed in the api logs: docker logs api 2>&1 | grep 'Magic link for'"
  );
} catch (error) {
  console.error('[dev-billing] fixture failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
