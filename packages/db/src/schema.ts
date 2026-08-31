import { relations, sql } from 'drizzle-orm';
import {
  text,
  timestamp,
  boolean,
  date,
  doublePrecision,
  integer,
  index,
  jsonb,
  pgSchema,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

export const appDb = pgSchema('app_db');

export const gender = appDb.enum('gender', ['male', 'female']);
export const accessControlRole = appDb.enum('access_control_role', [
  'family',
  'service-provider',
  'admin'
]);
export const approvalRequestStatus = appDb.enum('approval_request_status', [
  'submitted',
  'approved',
  'rejected'
]);
export const approvalStatus = appDb.enum('approval_status', ['approved', 'rejected']);
export const providerSearchOutboxStatus = appDb.enum('provider_search_outbox_status', [
  'pending',
  'processing',
  'processed',
  'failed',
  'superseded'
]);
export const familySearchOutboxStatus = appDb.enum('family_search_outbox_status', [
  'pending',
  'processing',
  'processed',
  'failed',
  'superseded'
]);
// "all" means every non-admin profile — admins are never shown T&C.
export const tcAppliesToRole = appDb.enum('tc_applies_to_role', [
  'all',
  'family',
  'service-provider'
]);
export const conversationStatus = appDb.enum('conversation_status', [
  'pending',
  'active',
  'ignored'
]);
// "ended" is never written today — an "ending" contract past its ends_on date
// presents as ended at read time (no cron). The value exists so a future job
// could materialise it without another enum migration.
export const contractStatus = appDb.enum('contract_status', [
  'draft',
  'proposed',
  'changes_requested',
  'declined',
  'active',
  'ending',
  'ended'
]);
// Withdrawing a pre-active proposal flips the row back to draft in place;
// "withdrawn" is the terminal state for a retracted amendment (an active
// contract has no draft stage to fall back to). "superseded" marks a
// previously accepted version replaced by an accepted amendment.
export const contractVersionStatus = appDb.enum('contract_version_status', [
  'draft',
  'proposed',
  'changes_requested',
  'accepted',
  'declined',
  'superseded',
  'withdrawn'
]);
export const kycDocumentStatus = appDb.enum('kyc_document_status', [
  'submitted',
  'approved',
  'rejected'
]);

// Poppynz safety verification. One lifecycle for both routes: ordering a check
// through Credibled, or submitting an existing document for admin review.
// `review_required` is where both converge — nothing reaches `verified`
// without a human decision, including a Credibled PASS.
export const safetyVerificationStatus = appDb.enum('safety_verification_status', [
  'not_started',
  'payment_pending',
  'invited',
  'in_progress',
  'review_required',
  'verified',
  'rejected',
  'expired'
]);
// Null until the applicant picks one; fixed for the life of the record.
export const safetyVerificationRoute = appDb.enum('safety_verification_route', [
  'credibled',
  'uploaded_document'
]);

export const user = appDb.table('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  isAnonymous: boolean('is_anonymous').default(false),
  role: text('role'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
  phoneNumber: text('phone_number').unique(),
  phoneNumberVerified: boolean('phone_number_verified')
});

export const signupIntent = appDb.table(
  'signup_intent',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    email: text('email').notNull(),
    role: text('role').notNull(),
    language: text('language').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    consumedAt: timestamp('consumed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [index('signup_intent_email_idx').on(table.email)]
);

export const userProfile = appDb.table('user_profile', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  language: text('language').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  gender: gender('gender'),
  phoneNumber: text('phone_number'),
  dateOfBirth: text('date_of_birth'),
  address: text('address'),
  city: text('city'),
  postalCode: text('postal_code'),
  country: text('country'),
  stateProvince: text('state_province'),
  shortBio: text('short_bio'),
  googlePlaceId: text('google_place_id'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude')
});

export const referral = appDb.table(
  'referral',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    referrerUserId: text('referrer_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    referredUserId: text('referred_user_id').references(() => user.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at').notNull(),
    joinedAt: timestamp('joined_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    index('referral_referrer_user_id_idx').on(table.referrerUserId),
    index('referral_email_idx').on(table.email)
  ]
);

export const kycDocumentType = appDb.table(
  'kyc_document_types',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    name: text('name').notNull(),
    appliesToRole: accessControlRole('applies_to_role').default('service-provider').notNull(),
    isOptional: boolean('is_optional').default(false).notNull(),
    requiresExpiryDate: boolean('requires_expiry_date').default(false).notNull(),
    // Credibled's stable check-type `value` (never its uuid — those are issued
    // per Credibled account). NULL means upload-only: either Credibled has no
    // equivalent product (vulnerable-sector checks) or we haven't confirmed one.
    // Fetchability is derived from this being present so the two can't disagree.
    credibledCheckTypeValue: text('credibled_check_type_value'),
    // What Poppynz charges for this check, pre-tax. Credibled's API exposes no
    // pricing at all, so somebody has to type it in — and a fetchable type
    // without a price is a configuration error, not a free check.
    credibledCostCents: integer('credibled_cost_cents'),
    // This type IS the applicant's safety-verification evidence — uploading it
    // creates the safety_verification record rather than an ordinary KYC
    // document, and the checklist reads its status from there. Exactly the
    // vulnerable-sector check today.
    backsSafetyVerification: boolean('backs_safety_verification').default(false).notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [index('kyc_document_types_deleted_at_idx').on(table.deletedAt)]
);

export const approvalRequest = appDb.table(
  'approval_requests',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: approvalRequestStatus('status').notNull(),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at'),
    reason: text('reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('approval_requests_user_id_idx').on(table.userId),
    index('approval_requests_status_idx').on(table.status)
  ]
);

export const approval = appDb.table(
  'approvals',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    approvalRequestId: uuid('approval_request_id')
      .notNull()
      .references(() => approvalRequest.id, { onDelete: 'restrict' }),
    approvedBy: text('approved_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    status: approvalStatus('status').notNull().default('rejected'),
    reason: text('reason'),
    expiresAt: timestamp('expires_at').notNull(),
    // Expiry-warning mail stamps, one per tier. Null = not sent. Firing a
    // shorter tier also stamps every longer tier so late-entering approvals
    // get exactly one mail (see the worker's approval-expiry processor).
    notifiedExpiresInOneMonthAt: timestamp('notified_expires_in_one_month_at'),
    notifiedExpiresInTwoWeeksAt: timestamp('notified_expires_in_two_weeks_at'),
    notifiedExpiresInOneWeekAt: timestamp('notified_expires_in_one_week_at'),
    notifiedExpiresInTwoDaysAt: timestamp('notified_expires_in_two_days_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('approvals_user_id_idx').on(table.userId),
    index('approvals_request_id_idx').on(table.approvalRequestId),
    index('approvals_status_expires_at_idx').on(table.status, table.expiresAt)
  ]
);

export const kycDocument = appDb.table(
  'kyc_documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    documentTypeId: uuid('document_type_id')
      .notNull()
      .references(() => kycDocumentType.id, { onDelete: 'restrict' }),
    filename: text('filename'),
    fileKey: text('file_key'),
    expiryDate: timestamp('expiry_date'),
    status: kycDocumentStatus('status').notNull(),
    reason: text('reason'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('kyc_documents_user_id_idx').on(table.userId),
    index('kyc_documents_document_type_id_idx').on(table.documentTypeId),
    uniqueIndex('kyc_documents_user_id_document_type_uidx').on(table.userId, table.documentTypeId)
  ]
);

// Mandatory safety verification, one record per applicant per role — a person
// who is both a family and a helper is screened twice and the rows never mix.
//
// Rejected and expired rows are kept as history; the partial unique index
// allows at most one live record per (user, role), so re-verification after a
// rejection or an expiry inserts a fresh row rather than mutating the audit
// trail.
export const safetyVerification = appDb.table(
  'safety_verifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: accessControlRole('role').notNull(),
    status: safetyVerificationStatus('status').notNull().default('not_started'),
    route: safetyVerificationRoute('route'),

    // Credibled's own id for the check. The API has no external-reference
    // field, so this is the only join key between their webhooks and our rows.
    credibledCheckUuid: text('credibled_check_uuid'),
    // The Credibled-hosted applicant link. We order with `send_email: false` so
    // the branding and reminder cadence stay ours, which means WE have to put
    // this in front of the applicant — without it the flow dead-ends at
    // "check your email" for mail nobody sent.
    applicationUrl: text('application_url'),

    consentAt: timestamp('consent_at'),
    consentPolicyVersion: text('consent_policy_version'),

    // Deliberately provider-agnostic: the payment port hands back opaque
    // references, so nothing in the schema commits to Stripe.
    paymentReference: text('payment_reference'),
    refundReference: text('refund_reference'),
    amountCents: integer('amount_cents'),
    feeCents: integer('fee_cents'),
    taxCents: integer('tax_cents'),
    totalCents: integer('total_cents'),

    // Uploaded-document route only.
    issuingAuthority: text('issuing_authority'),
    documentNumber: text('document_number'),
    filename: text('filename'),
    fileKey: text('file_key'),

    issuedOn: date('issued_on'),
    // Credibled reports completion, not expiry, so for that route this is
    // derived from policy (SAFETY_VERIFICATION_VALIDITY_MONTHS).
    expiresOn: date('expires_on'),

    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at'),
    decisionReason: text('decision_reason'),

    // One pre-expiry reminder per record, mirroring the approval sweep.
    expiryNotifiedAt: timestamp('expiry_notified_at'),

    // The row doubles as its own outbox: a paid-but-not-yet-ordered record is
    // retried by the worker, and past SAFETY_VERIFICATION_ORDER_MAX_ATTEMPTS
    // the charge is refunded rather than left hanging.
    orderAttempts: integer('order_attempts').default(0).notNull(),
    lastOrderError: text('last_order_error'),

    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('safety_verifications_user_role_live_uidx')
      .on(table.userId, table.role)
      .where(sql`${table.deletedAt} is null and ${table.status} not in ('rejected', 'expired')`),
    uniqueIndex('safety_verifications_credibled_uuid_uidx')
      .on(table.credibledCheckUuid)
      .where(sql`${table.credibledCheckUuid} is not null`),
    index('safety_verifications_user_id_idx').on(table.userId),
    index('safety_verifications_status_idx').on(table.status),
    index('safety_verifications_status_expires_on_idx').on(table.status, table.expiresOn)
  ]
);

// The applicant's basket of checks to order.
//
// A record in `not_started` holding items IS the basket: the applicant adds
// checks from the documents page, sees the itemised price on the verification
// page, and paying moves the same row to `payment_pending`. That keeps one
// live record per (user, role) — no separate cart concept to reconcile.
export const safetyVerificationItem = appDb.table(
  'safety_verification_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    verificationId: uuid('verification_id')
      .notNull()
      .references(() => safetyVerification.id, { onDelete: 'cascade' }),
    documentTypeId: uuid('document_type_id')
      .notNull()
      .references(() => kycDocumentType.id, { onDelete: 'restrict' }),
    credibledCheckTypeValue: text('credibled_check_type_value').notNull(),
    // Frozen when the item is added, so an admin editing the price mid-basket
    // cannot change what the applicant was quoted.
    costCents: integer('cost_cents').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('safety_verification_items_verification_type_uidx').on(
      table.verificationId,
      table.documentTypeId
    ),
    // Two document types could map to the same Credibled check; ordering it
    // twice would be charged twice and fulfilled once.
    uniqueIndex('safety_verification_items_verification_check_uidx').on(
      table.verificationId,
      table.credibledCheckTypeValue
    ),
    index('safety_verification_items_verification_id_idx').on(table.verificationId)
  ]
);

// Admin-managed base services providers pick from. `isLive` is catalogue
// visibility (hidden items stay on existing provider listings but can't be
// newly added) — deliberately distinct from `deletedAt` soft deletion.
export const serviceCatalogueItem = appDb.table(
  'service_catalogue',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    name: text('name').notNull(),
    category: text('category').notNull(),
    baseHourlyRateCents: integer('base_hourly_rate_cents').notNull(),
    currency: text('currency').default('CAD').notNull(),
    isLive: boolean('is_live').default(true).notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('service_catalogue_deleted_at_idx').on(table.deletedAt),
    index('service_catalogue_is_live_idx').on(table.isLive)
  ]
);

export const serviceOffered = appDb.table(
  'services_offered',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    catalogueServiceId: uuid('catalogue_service_id').references(() => serviceCatalogueItem.id, {
      onDelete: 'restrict'
    }),
    name: text('name').notNull(),
    description: text('description'),
    hourlyRateCents: integer('hourly_rate_cents').notNull(),
    currency: text('currency').default('CAD').notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('services_offered_user_id_idx').on(table.userId),
    index('services_offered_deleted_at_idx').on(table.deletedAt),
    index('services_offered_catalogue_service_id_idx').on(table.catalogueServiceId)
  ]
);

// Services a family is looking for. Mirrors services_offered but carries no
// rate — families describe needs, providers price them.
export const serviceNeeded = appDb.table(
  'services_needed',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    catalogueServiceId: uuid('catalogue_service_id').references(() => serviceCatalogueItem.id, {
      onDelete: 'restrict'
    }),
    name: text('name').notNull(),
    description: text('description'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('services_needed_user_id_idx').on(table.userId),
    index('services_needed_deleted_at_idx').on(table.deletedAt),
    index('services_needed_catalogue_service_id_idx').on(table.catalogueServiceId)
  ]
);

export const familySearchOutbox = appDb.table(
  'family_search_outbox',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: familySearchOutboxStatus('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('family_search_outbox_user_id_idx').on(table.userId),
    index('family_search_outbox_status_idx').on(table.status),
    uniqueIndex('family_search_outbox_user_unresolved_uidx')
      .on(table.userId)
      .where(sql`${table.status} in ('pending', 'processing', 'failed')`)
  ]
);

export const providerSearchOutbox = appDb.table(
  'provider_search_outbox',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: providerSearchOutboxStatus('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('provider_search_outbox_user_id_idx').on(table.userId),
    index('provider_search_outbox_status_idx').on(table.status),
    uniqueIndex('provider_search_outbox_user_unresolved_uidx')
      .on(table.userId)
      .where(sql`${table.status} in ('pending', 'processing', 'failed')`)
  ]
);

// Snapshot of a service referenced by a reach-out, taken at send time so the
// card keeps rendering even if the underlying service row is later renamed or
// soft-deleted. serviceId points at services_offered/services_needed depending
// on who initiated.
export type ReachoutService = {
  serviceId: string;
  name: string;
};

// A conversation pairs exactly one family with one provider and starts life as
// a reach-out: the initiator's templated intro plus the services in question.
// `pending` keeps the thread locked until the receiver responds; `ignored`
// archives it quietly and blocks a repeat reach-out until the cool-down
// (REACHOUT_IGNORE_COOLDOWN_DAYS) lapses — expired-ignored rows get
// soft-deleted on the next reach-out, which the partial pair-unique index
// permits while still guaranteeing one live conversation per pair.
export const conversation = appDb.table(
  'conversations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    familyUserId: text('family_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerUserId: text('provider_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    initiatorUserId: text('initiator_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: conversationStatus('status').default('pending').notNull(),
    reachoutMessage: text('reachout_message').notNull(),
    reachoutServices: jsonb('reachout_services').$type<Array<ReachoutService>>().notNull(),
    respondedAt: timestamp('responded_at'),
    ignoredAt: timestamp('ignored_at'),
    familyLastReadAt: timestamp('family_last_read_at'),
    providerLastReadAt: timestamp('provider_last_read_at'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('conversations_family_provider_uidx')
      .on(table.familyUserId, table.providerUserId)
      .where(sql`${table.deletedAt} is null`),
    index('conversations_provider_user_id_idx').on(table.providerUserId),
    index('conversations_status_idx').on(table.status)
  ]
);

export const conversationMessage = appDb.table(
  'conversation_messages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    senderUserId: text('sender_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('conversation_messages_conversation_created_idx').on(
      table.conversationId,
      table.createdAt
    ),
    index('conversation_messages_sender_user_id_idx').on(table.senderUserId)
  ]
);

// One proposed weekly session. Times are wall-clock minutes from midnight in
// New Zealand local time (Pacific/Auckland) — never UTC instants, so a
// "3:30–6:00 pm" session stays 3:30–6:00 pm across DST changes.
export type ContractSession = {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  /** Minutes from midnight, 0..1439. */
  startMinutes: number;
  /** Minutes from midnight, startMinutes < endMinutes <= 1440. */
  endMinutes: number;
};

// Snapshot of one provider service as agreed in a contract version, taken when
// the line item is added so the terms keep rendering (and the rate floor stays
// auditable) even if the underlying services_offered row is later renamed,
// repriced or soft-deleted. Weekly hours are always derived from sessions —
// they are never stored, so the two can't disagree.
export type ContractServiceItem = {
  serviceId: string;
  name: string;
  listedRateCents: number;
  rateCents: number;
  currency: string;
  sessions: Array<ContractSession>;
  expectations: string;
};

// A contract is the stable identity between one family and one provider,
// created only by the family from their active conversation (the structural
// anti-spam gate — there is no other entry point). Terms live in
// contract_versions; declined and ended rows stay live and are revived via a
// new version, so the partial unique index still guarantees one live contract
// per conversation.
export const contract = appDb.table(
  'contracts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    familyUserId: text('family_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerUserId: text('provider_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: contractStatus('status').default('draft').notNull(),
    // Ending with 2 weeks' notice: the last working day is derived at read time
    // as end_noticed_at + 14 days (the negotiated end date, if any, lives on
    // the version as a term). Past it the contract presents as ended.
    endedByUserId: text('ended_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    endNote: text('end_note'),
    endNoticedAt: timestamp('end_noticed_at'),
    // Per-side seen markers backing the sidebar Contracts badge.
    familySeenAt: timestamp('family_seen_at'),
    providerSeenAt: timestamp('provider_seen_at'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('contracts_conversation_uidx')
      .on(table.conversationId)
      .where(sql`${table.deletedAt} is null`),
    index('contracts_family_user_id_idx').on(table.familyUserId),
    index('contracts_provider_user_id_idx').on(table.providerUserId),
    index('contracts_status_idx').on(table.status)
  ]
);

// Every draft, proposal and amendment is a version row. At most one pending
// (draft/proposed) version and at most one accepted version exist per
// contract, both enforced by partial unique indexes — the accepted row IS the
// terms in force, so contracts needs no version pointer that could disagree
// with the version rows.
export const contractVersion = appDb.table(
  'contract_versions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contract.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    proposedByUserId: text('proposed_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: contractVersionStatus('status').default('draft').notNull(),
    services: jsonb('services').$type<Array<ContractServiceItem>>().notNull(),
    startsOn: date('starts_on'),
    // Optional negotiated term: the contract's last day. Past it an active
    // contract presents as ended at read time — a signed contract is never
    // amended; it runs out (or is ended with notice) and a new one is created.
    endsOn: date('ends_on'),
    sentAt: timestamp('sent_at'),
    decidedAt: timestamp('decided_at'),
    declineReason: text('decline_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('contract_versions_contract_version_uidx').on(table.contractId, table.version),
    uniqueIndex('contract_versions_pending_uidx')
      .on(table.contractId)
      .where(sql`${table.status} in ('draft', 'proposed')`),
    uniqueIndex('contract_versions_accepted_uidx')
      .on(table.contractId)
      .where(sql`${table.status} = 'accepted'`),
    index('contract_versions_contract_id_idx').on(table.contractId)
  ]
);

// Admin-managed terms-and-conditions documents. A document is a stable slug
// (e.g. "terms_of_service"); its text lives in tc_document_versions so every
// published revision is kept verbatim for the acceptance audit trail.
export const tcDocument = appDb.table(
  'tc_documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    appliesToRole: tcAppliesToRole('applies_to_role').default('all').notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('tc_documents_slug_uidx').on(table.slug),
    index('tc_documents_deleted_at_idx').on(table.deletedAt)
  ]
);

// Immutable once published (publishedAt set): users accepted that exact text,
// so published rows are never updated or deleted. publishedAt null = the
// document's single open draft, enforced by the partial unique index.
export const tcDocumentVersion = appDb.table(
  'tc_document_versions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => tcDocument.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    description: text('description').notNull(),
    content: text('content').notNull(),
    checkboxLabel: text('checkbox_label').notNull(),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('tc_document_versions_document_id_idx').on(table.documentId),
    uniqueIndex('tc_document_versions_document_id_version_uidx').on(
      table.documentId,
      table.version
    ),
    uniqueIndex('tc_document_versions_document_id_draft_uidx')
      .on(table.documentId)
      .where(sql`${table.publishedAt} is null`)
  ]
);

// Append-only audit log; rows are never updated or deleted. slug and version
// are denormalized so acceptance history stays queryable by slug even if a
// document is renamed or removed later.
export const tcDocumentAcceptance = appDb.table(
  'tc_document_acceptances',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => tcDocument.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => tcDocumentVersion.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    acceptedAt: timestamp('accepted_at').defaultNow().notNull()
  },
  (table) => [
    index('tc_document_acceptances_user_id_idx').on(table.userId),
    index('tc_document_acceptances_version_id_idx').on(table.versionId),
    uniqueIndex('tc_document_acceptances_user_id_version_id_uidx').on(table.userId, table.versionId)
  ]
);

export const session = appDb.table(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
    activeOrganizationId: text('active_organization_id')
  },
  (table) => [index('session_userId_idx').on(table.userId)]
);

export const account = appDb.table(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [index('account_userId_idx').on(table.userId)]
);

export const verification = appDb.table(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)]
);

export const apikey = appDb.table(
  'apikey',
  {
    id: text('id').primaryKey(),
    configId: text('config_id').default('default').notNull(),
    name: text('name'),
    start: text('start'),
    referenceId: text('reference_id').notNull(),
    prefix: text('prefix'),
    key: text('key').notNull(),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: timestamp('last_refill_at'),
    enabled: boolean('enabled').default(true),
    rateLimitEnabled: boolean('rate_limit_enabled').default(true),
    rateLimitTimeWindow: integer('rate_limit_time_window').default(86400000),
    rateLimitMax: integer('rate_limit_max').default(10),
    requestCount: integer('request_count').default(0),
    remaining: integer('remaining'),
    lastRequest: timestamp('last_request'),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    permissions: text('permissions'),
    metadata: text('metadata')
  },
  (table) => [
    index('apikey_configId_idx').on(table.configId),
    index('apikey_referenceId_idx').on(table.referenceId),
    index('apikey_key_idx').on(table.key)
  ]
);

export const organization = appDb.table(
  'organization',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    logo: text('logo'),
    createdAt: timestamp('created_at').notNull(),
    metadata: text('metadata')
  },
  (table) => [uniqueIndex('organization_slug_uidx').on(table.slug)]
);

export const member = appDb.table(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').default('member').notNull(),
    createdAt: timestamp('created_at').notNull()
  },
  (table) => [
    index('member_organizationId_idx').on(table.organizationId),
    index('member_userId_idx').on(table.userId)
  ]
);

export const invitation = appDb.table(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').default('pending').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' })
  },
  (table) => [
    index('invitation_organizationId_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email)
  ]
);

// Snapshot of the searcher's profile location, taken server-side at save time
// so the admin sees where the family was when nothing matched — even if they
// move later.
export type UserSearchLocation = {
  city?: string;
  stateProvince?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
};

// Full filter set of a family marketplace search, captured verbatim when the
// family asks the Poppynz team for help with a search that came up empty.
// Stored as loose JSON so old rows keep rendering as the filter set evolves.
export type UserSearchDetails = {
  q?: string;
  service?: string;
  city?: string;
  radiusKm?: number;
  minHourlyRateCents?: number;
  maxHourlyRateCents?: number;
  sort?: string;
  location?: UserSearchLocation;
};

export const userSearch = appDb.table(
  'user_search',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    details: jsonb('details').$type<UserSearchDetails>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    index('user_search_user_id_idx').on(table.userId),
    index('user_search_created_at_idx').on(table.createdAt)
  ]
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  invitations: many(invitation),
  approvals: many(approval),
  approvalRequests: many(approvalRequest),
  kycDocuments: many(kycDocument),
  safetyVerifications: many(safetyVerification, {
    relationName: 'safetyVerificationApplicant'
  }),
  servicesOffered: many(serviceOffered),
  servicesNeeded: many(serviceNeeded),
  tcDocumentAcceptances: many(tcDocumentAcceptance)
}));

export const tcDocumentRelations = relations(tcDocument, ({ many }) => ({
  versions: many(tcDocumentVersion),
  acceptances: many(tcDocumentAcceptance)
}));

export const tcDocumentVersionRelations = relations(tcDocumentVersion, ({ one, many }) => ({
  document: one(tcDocument, {
    fields: [tcDocumentVersion.documentId],
    references: [tcDocument.id]
  }),
  acceptances: many(tcDocumentAcceptance)
}));

export const tcDocumentAcceptanceRelations = relations(tcDocumentAcceptance, ({ one }) => ({
  user: one(user, {
    fields: [tcDocumentAcceptance.userId],
    references: [user.id]
  }),
  document: one(tcDocument, {
    fields: [tcDocumentAcceptance.documentId],
    references: [tcDocument.id]
  }),
  version: one(tcDocumentVersion, {
    fields: [tcDocumentAcceptance.versionId],
    references: [tcDocumentVersion.id]
  })
}));

export const approvalRequestRelations = relations(approvalRequest, ({ one, many }) => ({
  user: one(user, {
    fields: [approvalRequest.userId],
    references: [user.id]
  }),
  reviewer: one(user, {
    fields: [approvalRequest.reviewedBy],
    references: [user.id]
  }),
  approvals: many(approval)
}));

export const approvalRelations = relations(approval, ({ one }) => ({
  user: one(user, {
    fields: [approval.userId],
    references: [user.id]
  }),
  approver: one(user, {
    fields: [approval.approvedBy],
    references: [user.id]
  }),
  approvalRequest: one(approvalRequest, {
    fields: [approval.approvalRequestId],
    references: [approvalRequest.id]
  })
}));

export const kycDocumentRelations = relations(kycDocument, ({ one }) => ({
  user: one(user, {
    fields: [kycDocument.userId],
    references: [user.id]
  }),
  documentType: one(kycDocumentType, {
    fields: [kycDocument.documentTypeId],
    references: [kycDocumentType.id]
  })
}));

export const safetyVerificationItemRelations = relations(safetyVerificationItem, ({ one }) => ({
  verification: one(safetyVerification, {
    fields: [safetyVerificationItem.verificationId],
    references: [safetyVerification.id]
  }),
  documentType: one(kycDocumentType, {
    fields: [safetyVerificationItem.documentTypeId],
    references: [kycDocumentType.id]
  })
}));

export const safetyVerificationRelations = relations(safetyVerification, ({ one, many }) => ({
  items: many(safetyVerificationItem),
  user: one(user, {
    fields: [safetyVerification.userId],
    references: [user.id],
    relationName: 'safetyVerificationApplicant'
  }),
  reviewer: one(user, {
    fields: [safetyVerification.reviewedBy],
    references: [user.id],
    relationName: 'safetyVerificationReviewer'
  })
}));

export const kycDocumentTypeRelations = relations(kycDocumentType, ({ many }) => ({
  documents: many(kycDocument)
}));

export const serviceOfferedRelations = relations(serviceOffered, ({ one }) => ({
  user: one(user, {
    fields: [serviceOffered.userId],
    references: [user.id]
  }),
  catalogueItem: one(serviceCatalogueItem, {
    fields: [serviceOffered.catalogueServiceId],
    references: [serviceCatalogueItem.id]
  })
}));

export const serviceNeededRelations = relations(serviceNeeded, ({ one }) => ({
  user: one(user, {
    fields: [serviceNeeded.userId],
    references: [user.id]
  }),
  catalogueItem: one(serviceCatalogueItem, {
    fields: [serviceNeeded.catalogueServiceId],
    references: [serviceCatalogueItem.id]
  })
}));

export const serviceCatalogueItemRelations = relations(serviceCatalogueItem, ({ many }) => ({
  servicesOffered: many(serviceOffered),
  servicesNeeded: many(serviceNeeded)
}));

export const conversationRelations = relations(conversation, ({ one, many }) => ({
  familyUser: one(user, {
    fields: [conversation.familyUserId],
    references: [user.id]
  }),
  providerUser: one(user, {
    fields: [conversation.providerUserId],
    references: [user.id]
  }),
  messages: many(conversationMessage)
}));

export const conversationMessageRelations = relations(conversationMessage, ({ one }) => ({
  conversation: one(conversation, {
    fields: [conversationMessage.conversationId],
    references: [conversation.id]
  }),
  sender: one(user, {
    fields: [conversationMessage.senderUserId],
    references: [user.id]
  })
}));

export const contractRelations = relations(contract, ({ one, many }) => ({
  conversation: one(conversation, {
    fields: [contract.conversationId],
    references: [conversation.id]
  }),
  familyUser: one(user, {
    fields: [contract.familyUserId],
    references: [user.id]
  }),
  providerUser: one(user, {
    fields: [contract.providerUserId],
    references: [user.id]
  }),
  versions: many(contractVersion)
}));

export const contractVersionRelations = relations(contractVersion, ({ one }) => ({
  contract: one(contract, {
    fields: [contractVersion.contractId],
    references: [contract.id]
  }),
  proposer: one(user, {
    fields: [contractVersion.proposedByUserId],
    references: [user.id]
  })
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id]
  })
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id]
  })
}));

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation)
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id]
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id]
  })
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id]
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id]
  })
}));
