import { relations, sql } from 'drizzle-orm';
import {
  text,
  timestamp,
  boolean,
  check,
  date,
  doublePrecision,
  integer,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

export const appDb = pgSchema('app_db');

export const gender = appDb.enum('gender', ['male', 'female']);
export const accessControlRole = appDb.enum('access_control_role', [
  'family',
  'service-provider',
  'admin',
  // Poppynz's accountant: the tax portal only (migrations/0031_accountant_role).
  'accountant'
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
// "terms" documents gate sign-up and sign-in (TcGate); the one live
// "service_agreement" document is the written agreement both parties sign on
// a contract (UAT round 2, item 4) — a template, never shown by the gate.
export const tcDocumentKind = appDb.enum('tc_document_kind', ['terms', 'service_agreement']);
// Which side of a contract signed a service agreement.
export const contractAgreementSigner = appDb.enum('contract_agreement_signer', [
  'family',
  'helper'
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
// How a document came to exist: the applicant uploaded a file, or Credibled
// completed the check on their behalf. A fetched document holds no file — the
// report stays with the vendor and is opened on demand from the safety
// verification review, never copied into our storage.
export const kycDocumentSource = appDb.enum('kyc_document_source', ['upload', 'credibled']);

// Poppynz safety verification — the VERDICT only. A record is created once
// evidence exists (an uploaded document, or a Credibled order that completed)
// and starts in `review_required`: nothing reaches `verified` without a human
// decision, including a Credibled PASS. How the evidence was obtained, paid
// for and chased is the business of `check_orders` and `payments`, not this
// enum.
export const safetyVerificationStatus = appDb.enum('safety_verification_status', [
  'review_required',
  'verified',
  'rejected',
  'expired'
]);
// How the evidence behind a verdict arrived. Fixed for the life of the record.
export const safetyVerificationRoute = appDb.enum('safety_verification_route', [
  'credibled',
  'uploaded_document'
]);

// What a charge was for. The subject table points at `payments`, never the
// reverse, so a new purpose is a new value here plus a foreign key on its own
// table — not a new payments table.
export const paymentKind = appDb.enum('payment_kind', ['credibled_order', 'contract_cycle']);
// `captured` is what the settle path writes once the provider confirms the
// money (automatic capture). `authorised` remains for rows the pre-Stripe
// mock wrote and for a later hold-then-capture flow (contract billing).
export const paymentStatus = appDb.enum('payment_status', [
  'pending',
  'authorised',
  'captured',
  'refunded',
  'failed'
]);
// A Credibled order's own progress: the basket, the charge, the vendor.
// `draft` is the basket; `payment_pending` is the window between claiming the
// order for a charge and the provider confirming it; `paid` is charged but not
// yet placed with Credibled (the worker retries this); the rest mirror what
// Credibled reports. Only `complete` produces a safety verdict.
export const checkOrderStatus = appDb.enum('check_order_status', [
  'draft',
  'payment_pending',
  'paid',
  'invited',
  'in_progress',
  'complete',
  'failed',
  'cancelled'
]);
// What Credibled concluded about a finished check, read off its own scores.
// Informs the administrator and orders the review queue; never a verdict.
// Unfamiliar scores land in `not_cleared` so they reach a person as a flag.
export const checkOrderOutcome = appDb.enum('check_order_outcome', [
  'cleared',
  'not_cleared',
  'inconclusive'
]);
// A vouch's own lifecycle. `expired` is not stored — a pending row past
// expires_at presents as expired at read time, like referrals.
export const vouchStatus = appDb.enum('vouch_status', [
  'pending',
  'accepted',
  'declined',
  'revoked',
  'flagged'
]);

// Admin review of a helper's custom (non-catalogue) service. Catalogue-linked
// services are approved on creation — their name and floor come from the
// catalogue — so only free-text services wait in the queue.
export const serviceReviewStatus = appDb.enum('service_review_status', [
  'pending',
  'approved',
  'rejected'
]);
// Derived by the API from the three Stripe readiness flags; see
// migrations/0026_payout_accounts.sql.
export const payoutAccountStatus = appDb.enum('payout_account_status', [
  'onboarding',
  'ready',
  'restricted',
  'disabled'
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

// One-off UI prompts a user has dismissed (the family getting-started pop-up,
// UAT #16), keyed by a stable prompt name. Server-side so a dismissal holds
// across devices and browsers instead of living in localStorage.
export const userDismissal = appDb.table(
  'user_dismissals',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    dismissedAt: timestamp('dismissed_at').defaultNow().notNull()
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })]
);

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

/** The voucher's answers to the six-question form. Admin-only, always. */
export type VouchAnswers = {
  howKnow: string;
  howLong: string;
  wouldTrust: 'yes' | 'no' | 'unsure';
  hasConcerns: boolean;
  concernsDetail: string | null;
  wouldHire: 'yes' | 'no' | 'unsure';
  anythingElse: string | null;
};

// An approved member endorsing a helper applicant. Approval never reads this
// table — vouches inform the admin and nudge the applicant, nothing more.
export const vouch = appDb.table(
  'vouches',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    applicantUserId: text('applicant_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    voucherUserId: text('voucher_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // The voucher's role when asked — a later role change doesn't rewrite history.
    voucherRole: accessControlRole('voucher_role').notNull(),
    // The applicant's own description of how they know the voucher.
    relationship: text('relationship').notNull(),
    status: vouchStatus('status').notNull().default('pending'),
    answers: jsonb('answers').$type<VouchAnswers>(),
    attestedAt: timestamp('attested_at'),
    expiresAt: timestamp('expires_at').notNull(),
    decidedAt: timestamp('decided_at'),
    // Who revoked or flagged it: the voucher withdrawing, or an admin.
    revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'set null' }),
    adminReason: text('admin_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('vouches_applicant_user_id_idx').on(table.applicantUserId),
    index('vouches_voucher_user_id_idx').on(table.voucherUserId),
    uniqueIndex('vouches_pair_accepted_uidx')
      .on(table.applicantUserId, table.voucherUserId)
      .where(sql`${table.status} = 'accepted'`)
  ]
);

// A vouch request whose email names nobody who can vouch (no account, the
// wrong role, not in good standing, or a pair that is closed). It is kept so
// the applicant's own list shows it exactly like a delivered request — the
// list must not reveal who is a member (R11, UAT #36) — but it is never
// delivered to anyone and simply expires. Delivered requests live in vouches.
export const undeliveredVouchRequest = appDb.table(
  'undelivered_vouch_requests',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    applicantUserId: text('applicant_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // As the applicant typed it (normalised to lowercase by the validator).
    voucherEmail: text('voucher_email').notNull(),
    relationship: text('relationship').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [index('undelivered_vouch_requests_applicant_idx').on(table.applicantUserId)]
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
    // This type IS the safety gate for its role — uploading it creates the
    // safety_verification record rather than an ordinary KYC document, and
    // the checklist reads its status from there. Exactly one per role, which
    // the partial unique index below enforces: two gates would put two
    // entries on the checklist both reading the same verdict.
    isSafetyGate: boolean('is_safety_gate').default(false).notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('kyc_document_types_deleted_at_idx').on(table.deletedAt),
    uniqueIndex('kyc_document_types_role_gate_uidx')
      .on(table.appliesToRole)
      .where(sql`${table.isSafetyGate} and ${table.deletedAt} is null`)
  ]
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
    // Admin-only free text, typically notes from an off-app chat with the
    // applicant. Never shown to the applicant.
    generalRemarks: text('general_remarks'),
    generalRemarksUpdatedBy: text('general_remarks_updated_by').references(() => user.id, {
      onDelete: 'set null'
    }),
    generalRemarksUpdatedAt: timestamp('general_remarks_updated_at'),
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
    // Null for a fetched document — see `kyc_document_source`.
    filename: text('filename'),
    fileKey: text('file_key'),
    expiryDate: timestamp('expiry_date'),
    // Date-only, as printed on the document. Optional for every type.
    issuedOn: date('issued_on'),
    status: kycDocumentStatus('status').notNull(),
    source: kycDocumentSource('source').notNull().default('upload'),
    reason: text('reason'),
    // Who decided this document and when. Null while it awaits review; a
    // re-upload clears both so the new file is reviewed afresh.
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at'),
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

// Money changing hands, independent of what it paid for.
//
// One row per charge attempt. The row is inserted `pending` BEFORE the
// provider is asked for money and its id is the idempotency key — that
// ordering is what lets an asynchronous confirmation (a Stripe webhook, later)
// find the row it belongs to, and it means a retry after a decline is a fresh
// row with a fresh key rather than a replay of the declined one.
//
// Deliberately provider-agnostic: `provider` + `provider_reference` together
// identify the charge at whichever gateway made it, so nothing here commits
// to Stripe. The itemised breakdown is frozen at authorisation and never
// recomputed for display.
/** One frozen tax line on a payment (mirrors `TaxLine` in @repo/billing/pricing). */
export type PaymentTaxLine = {
  supplyType: string;
  jurisdiction: string;
  component: string;
  rateMillipercent: number;
  baseCents: number;
  taxCents: number;
  label: string;
  registrationNumber: string | null;
};

export const payment = appDb.table(
  'payments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    kind: paymentKind('kind').notNull(),
    status: paymentStatus('status').notNull().default('pending'),
    provider: text('provider').notNull(),
    providerReference: text('provider_reference'),
    refundReference: text('refund_reference'),
    amountCents: integer('amount_cents').notNull(),
    feeCents: integer('fee_cents').notNull(),
    taxCents: integer('tax_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    currency: text('currency').notNull().default('CAD'),
    // A failed refund must stay visible — this is where "needs manual
    // settlement" lives, on the row that holds the money.
    lastError: text('last_error'),
    authorisedAt: timestamp('authorised_at'),
    capturedAt: timestamp('captured_at'),
    refundedAt: timestamp('refunded_at'),
    // The provider's receipt page for a captured charge (Stripe hosts it).
    // Shown in the family's payment history; null for mock payments.
    receiptUrl: text('receipt_url'),
    // Per-line tax frozen at quote time (see migrations/0028_payment_tax_lines).
    taxLines: jsonb('tax_lines')
      .$type<Array<PaymentTaxLine>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // The payer's history label; null falls back to the kind's description.
    description: text('description'),
    // What a hold-then-capture payment took; null until captured.
    capturedCents: integer('captured_cents'),
    // A contract hold Poppynz released without capturing (see
    // migrations/0030_billing_fixes): shown as "Not charged", never "failed".
    releasedAt: timestamp('released_at'),
    // An off-session attempt (contract billing) is frozen at creation: the
    // card it charges and the idempotency key it is sent under, so a retry
    // or a replay of that attempt is byte-for-byte the same request even
    // after the family replaces the card (see migrations/0038).
    cardReference: text('card_reference'),
    chargeKey: text('charge_key'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    // How an inbound provider event (webhook) finds its row.
    uniqueIndex('payments_provider_reference_uidx')
      .on(table.provider, table.providerReference)
      .where(sql`${table.providerReference} is not null`),
    index('payments_user_id_idx').on(table.userId),
    index('payments_status_idx').on(table.status),
    // The recovery job's scan: charges still waiting on the provider.
    index('payments_pending_created_at_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending' and ${table.providerReference} is not null`)
  ]
);

// A paying user's customer at the payment gateway, and the one card kept on
// file for them (families only today — helpers pay one-off). The card columns
// are display copies; the card itself lives with the gateway. `restrict`, so
// a user with a gateway customer cannot be deleted from under it.
export const billingCustomer = appDb.table(
  'billing_customers',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    customerReference: text('customer_reference').notNull(),
    cardReference: text('card_reference'),
    cardBrand: text('card_brand'),
    cardLast4: text('card_last4'),
    cardExpMonth: integer('card_exp_month'),
    cardExpYear: integer('card_exp_year'),
    // The card setup most recently started for this user. The webhook may
    // put that setup's card on file even over an existing card: it is the
    // one the payer is confirming now, never a stale replay.
    latestSetupReference: text('latest_setup_reference'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    // How a webhook's customer finds its user.
    uniqueIndex('billing_customers_provider_customer_uidx').on(
      table.provider,
      table.customerReference
    )
  ]
);

// Every Stripe webhook delivery we accepted, by event id: de-duplication
// (Stripe delivers at least once) and an audit trail. The payload is NOT
// stored — handlers re-fetch the object from Stripe and act on that.
export const stripeWebhookEvent = appDb.table(
  'stripe_webhook_events',
  {
    eventId: text('event_id').primaryKey(),
    type: text('type').notNull(),
    objectId: text('object_id').notNull(),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),
    error: text('error')
  },
  (table) => [index('stripe_webhook_events_received_at_idx').on(table.receivedAt)]
);

// A helper's payout account (Stripe Connect Express). Holds the last snapshot
// RE-FETCHED from the provider — never webhook payload contents.
export const payoutAccount = appDb.table(
  'payout_accounts',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    accountReference: text('account_reference').notNull(),
    status: payoutAccountStatus('status').notNull().default('onboarding'),
    detailsSubmitted: boolean('details_submitted').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    transfersActive: boolean('transfers_active').notNull().default(false),
    // Raw provider requirement codes; the API turns them into labels.
    requirementsDue: jsonb('requirements_due')
      .$type<Array<string>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    disabledReason: text('disabled_reason'),
    // Null until the first re-fetch; drives PAYOUTS_REFRESH_AFTER_MINUTES.
    refreshedAt: timestamp('refreshed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [uniqueIndex('payout_accounts_account_reference_uidx').on(table.accountReference)]
);

// ---------------------------------------------------------------------------
// Sales-tax configuration (piece 3, spec §3a). DATA, seeded with defaults and
// corrected later by an accountant: nothing tax-related is hard-coded. Every
// effective-dated row covers [effective_from, effective_to); an edit closes
// the row in force and inserts a new one (never rewrites history), a removal
// sets deleted_at, and every change appends a tax_config_audit row. Overlaps
// between live rows are refused by EXCLUDE constraints (see 0027_tax_config).

export const taxJurisdictionKind = appDb.enum('tax_jurisdiction_kind', [
  'federal',
  'province',
  'territory'
]);
export const taxComponent = appDb.enum('tax_component', ['gst', 'hst', 'pst', 'qst', 'rst']);
export const taxTreatment = appDb.enum('tax_treatment', [
  'taxable',
  'exempt',
  'zero_rated',
  'out_of_scope'
]);
export const taxPlaceOfSupply = appDb.enum('tax_place_of_supply', [
  'payer_province',
  'helper_province',
  'contract_location'
]);
export const taxConfigAuditAction = appDb.enum('tax_config_audit_action', [
  'create',
  'close',
  'delete'
]);

/** `CA` (federal) and the 13 provinces and territories. */
export const taxJurisdiction = appDb.table('tax_jurisdictions', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  kind: taxJurisdictionKind('kind').notNull()
});

/** One rate per jurisdiction and component at any date. `rate_millipercent`
 * is thousandths of a percent (basis points × 10): 5% = 5000, 9.975% = 9975. */
export const taxRate = appDb.table(
  'tax_rates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    jurisdictionCode: text('jurisdiction_code')
      .notNull()
      .references(() => taxJurisdiction.code, { onDelete: 'restrict' }),
    component: taxComponent('component').notNull(),
    rateMillipercent: integer('rate_millipercent').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    index('tax_rates_jurisdiction_component_idx').on(table.jurisdictionCode, table.component)
  ]
);

/** What Poppynz charges for, each with its treatment over time. */
export const taxSupplyType = appDb.table('tax_supply_types', {
  code: text('code').primaryKey(),
  name: text('name').notNull()
});

export const taxSupplyTreatment = appDb.table(
  'tax_supply_treatments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    supplyTypeCode: text('supply_type_code')
      .notNull()
      .references(() => taxSupplyType.code, { onDelete: 'restrict' }),
    treatment: taxTreatment('treatment').notNull(),
    components: taxComponent('components').array().notNull(),
    placeOfSupply: taxPlaceOfSupply('place_of_supply').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [index('tax_supply_treatments_supply_type_idx').on(table.supplyTypeCode)]
);

/** Poppynz's own registrations. A component is charged only while a
 * registration in force with registered = true covers it. */
export const taxRegistration = appDb.table(
  'tax_registrations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    jurisdictionCode: text('jurisdiction_code')
      .notNull()
      .references(() => taxJurisdiction.code, { onDelete: 'restrict' }),
    program: text('program').notNull(),
    components: taxComponent('components').array().notNull(),
    registrationNumber: text('registration_number'),
    registered: boolean('registered').notNull(),
    isPlaceholder: boolean('is_placeholder').notNull().default(false),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [index('tax_registrations_program_idx').on(table.jurisdictionCode, table.program)]
);

/** Append-only history of every tax configuration change. */
export const taxConfigAudit = appDb.table(
  'tax_config_audit',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    entity: text('entity').notNull(),
    recordId: text('record_id').notNull(),
    action: taxConfigAuditAction('action').notNull(),
    // Null for the seed and system changes.
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [index('tax_config_audit_record_idx').on(table.entity, table.recordId)]
);

// A Credibled order: the basket, the charge it settled with, and the vendor's
// progress on it. Deliberately NOT the safety verdict — an order that
// completes creates a `safety_verifications` row in `review_required`, which
// is where the administrator's decision lives. Keeping the two apart is what
// stops vendor state (invited, in_progress) leaking into the meaning of
// "verified", and lets a family gate on an upload-only document without ever
// touching this table.
//
// One open order per (user, role), mirroring the verdict's live-slot index.
// Finished orders (complete, failed, cancelled) are kept as history.
export const checkOrder = appDb.table(
  'check_orders',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: accessControlRole('role').notNull(),
    status: checkOrderStatus('status').notNull().default('draft'),
    // Set when the order is claimed for a charge. `set null` rather than
    // `restrict` so a payments row can be purged without orphaning history.
    paymentId: uuid('payment_id').references(() => payment.id, { onDelete: 'set null' }),

    // Credibled's own id for the check. Their API has no external-reference
    // field, so this is the only join key between their webhooks and our rows.
    credibledCheckUuid: text('credibled_check_uuid'),
    // The Credibled-hosted applicant link, surfaced in-app so the flow never
    // dead-ends on an email the applicant may not have seen.
    applicationUrl: text('application_url'),

    consentAt: timestamp('consent_at'),
    consentPolicyVersion: text('consent_policy_version'),

    // The row doubles as its own outbox: a paid-but-not-yet-placed order is
    // retried by the worker, and past SAFETY_VERIFICATION_ORDER_MAX_ATTEMPTS
    // the charge is refunded rather than left hanging.
    orderAttempts: integer('order_attempts').default(0).notNull(),
    lastOrderError: text('last_order_error'),
    completedAt: timestamp('completed_at'),
    // Set once, on completion. Null on an order that never finished, and on
    // orders completed before outcomes were recorded.
    outcome: checkOrderOutcome('outcome'),
    // Credibled's overall score, verbatim ("Cleared", …).
    credibledScore: text('credibled_score'),

    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('check_orders_user_role_open_uidx')
      .on(table.userId, table.role)
      .where(
        sql`${table.deletedAt} is null and ${table.status} in ('draft', 'payment_pending', 'paid', 'invited', 'in_progress')`
      ),
    uniqueIndex('check_orders_credibled_uuid_uidx')
      .on(table.credibledCheckUuid)
      .where(sql`${table.credibledCheckUuid} is not null`),
    index('check_orders_user_id_idx').on(table.userId),
    index('check_orders_status_idx').on(table.status)
  ]
);

// The checks in an order. Added while the order is a draft; frozen once paid.
export const checkOrderItem = appDb.table(
  'check_order_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => checkOrder.id, { onDelete: 'cascade' }),
    documentTypeId: uuid('document_type_id')
      .notNull()
      .references(() => kycDocumentType.id, { onDelete: 'restrict' }),
    credibledCheckTypeValue: text('credibled_check_type_value').notNull(),
    // Frozen when the item is added, so an admin editing the price mid-basket
    // cannot change what the applicant was quoted.
    costCents: integer('cost_cents').notNull(),
    // This check's own result, recorded when the order completes. Null when
    // Credibled's result named no check we could match to this item.
    outcome: checkOrderOutcome('outcome'),
    credibledStatus: text('credibled_status'),
    credibledScore: text('credibled_score'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('check_order_items_order_type_uidx').on(table.orderId, table.documentTypeId),
    // Two document types could map to the same Credibled check; ordering it
    // twice would be charged twice and fulfilled once.
    uniqueIndex('check_order_items_order_check_uidx').on(
      table.orderId,
      table.credibledCheckTypeValue
    ),
    index('check_order_items_order_id_idx').on(table.orderId)
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
    // No default: a verdict is always created with explicit evidence behind
    // it, so the caller always knows the status it starts in.
    status: safetyVerificationStatus('status').notNull(),
    route: safetyVerificationRoute('route').notNull(),
    // The Credibled order this verdict came out of; null for an uploaded
    // document. Non-null here is also what tells an administrator there is a
    // vendor report to open.
    checkOrderId: uuid('check_order_id').references(() => checkOrder.id, {
      onDelete: 'set null'
    }),

    consentAt: timestamp('consent_at'),
    consentPolicyVersion: text('consent_policy_version'),

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
    index('safety_verifications_user_id_idx').on(table.userId),
    index('safety_verifications_check_order_id_idx').on(table.checkOrderId),
    index('safety_verifications_status_idx').on(table.status),
    index('safety_verifications_status_expires_on_idx').on(table.status, table.expiresOn)
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
    // Credential gate: a helper may only offer (and is only listed for) this
    // service while their document of this type is admin-approved — e.g.
    // Personal support (PSW) requires an approved PSW credential.
    requiredDocumentTypeId: uuid('required_document_type_id').references(() => kycDocumentType.id, {
      onDelete: 'restrict'
    }),
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
    // Families only ever see `approved` services (UAT #34).
    reviewStatus: serviceReviewStatus('review_status').default('approved').notNull(),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at'),
    // Shown to the helper when a custom service is rejected.
    reviewReason: text('review_reason'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('services_offered_user_id_idx').on(table.userId),
    index('services_offered_review_status_idx').on(table.reviewStatus),
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

/** What the chat scanner recognised in a message. */
export type ContactDetailKind = 'phone' | 'email' | 'link';

// Evidence trail for UAT #38: sharing contact details in chat is allowed, but
// every time a phone number, email address or link is detected both people
// are warned that off-platform dealings aren't covered, and the warning is
// recorded here — who sent it, in which conversation, when, and what kind of
// detail it was. The message body itself stays in conversation_messages.
export const contactDetailWarning = appDb.table(
  'contact_detail_warnings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'restrict' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => conversationMessage.id, { onDelete: 'restrict' }),
    senderUserId: text('sender_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    kinds: jsonb('kinds').$type<Array<ContactDetailKind>>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('contact_detail_warnings_message_uidx').on(table.messageId),
    index('contact_detail_warnings_conversation_idx').on(table.conversationId, table.createdAt),
    index('contact_detail_warnings_sender_idx').on(table.senderUserId)
  ]
);

// One proposed weekly session. Times are wall-clock minutes from midnight in
// the contract version's own time zone (`contract_versions.time_zone`) — never
// UTC instants, so a "3:30–6:00 pm" session stays 3:30–6:00 pm across DST.
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
    // restrict (umbrella §10): a contract carries money, so its people are
    // never hard-deleted from under it.
    familyUserId: text('family_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    providerUserId: text('provider_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
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
    // Optional last-day end time for the negotiated end date: wall-clock
    // minutes (1..1440) in time_zone. Sessions on that day are cut at it.
    endsAtMinutes: integer('ends_at_minutes'),
    // IANA zone the version's dates and session times are read in — the
    // family's, taken from their location when the terms are sent and frozen
    // at acceptance. Null only while the version is a draft.
    timeZone: text('time_zone'),
    sentAt: timestamp('sent_at'),
    // The family's explicit "Sign & send" (UAT #41). Set together with
    // sent_at; the helper's signature is their acceptance (decided_at).
    familySignedAt: timestamp('family_signed_at'),
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
    index('contract_versions_contract_id_idx').on(table.contractId),
    check(
      'contract_versions_time_zone_when_sent',
      sql`${table.status} = 'draft' or ${table.timeZone} is not null`
    ),
    check(
      'contract_versions_ends_at_minutes_valid',
      sql`${table.endsAtMinutes} is null or (${table.endsOn} is not null and ${table.endsAtMinutes} between 1 and 1440)`
    )
  ]
);

// ---------------------------------------------------------------------------
// Contract billing (piece 3; see migrations/0029_contract_billing.sql and the
// piece 3 spec). Every foreign key is restrict: money rows are never deleted
// from under each other, and soft state lives in status columns.

export const contractBillingStatus = appDb.enum('contract_billing_status', [
  'awaiting_payment_readiness',
  'scheduled',
  'active',
  'suspended',
  'cancelled',
  'ended'
]);
export const contractBillingSuspension = appDb.enum('contract_billing_suspension', [
  'card',
  'helper_not_ready',
  'provider_unavailable'
]);
export const contractCycleStatus = appDb.enum('contract_cycle_status', [
  'scheduled',
  'authorising',
  'authorised',
  'grace',
  'capturing',
  'captured',
  'suspended',
  'capture_failed',
  'cancelled',
  'empty',
  'carried'
]);
export const contractCycleChargeMode = appDb.enum('contract_cycle_charge_mode', [
  'hold',
  'immediate',
  'resume'
]);
export const contractSessionStatus = appDb.enum('contract_session_status', [
  'scheduled',
  'completed',
  'cancelled',
  'disputed',
  'suspended'
]);
export const billingLedgerKind = appDb.enum('billing_ledger_kind', [
  'session',
  'service_tax',
  'family_fee',
  'family_fee_tax',
  'provider_commission',
  'provider_commission_tax',
  'capture',
  'carry_forward',
  'carry_absorbed',
  'hold_released'
]);
export const billingLedgerParty = appDb.enum('billing_ledger_party', [
  'family',
  'provider',
  'platform'
]);

/** A frozen tax line on a cycle (same shape as on payments). */
export type CycleTaxLine = PaymentTaxLine;

/** One accepted contract's billing schedule and its frozen terms. */
export const contractBilling = appDb.table(
  'contract_billing',
  {
    contractId: uuid('contract_id')
      .primaryKey()
      .references(() => contract.id, { onDelete: 'restrict' }),
    acceptedVersionId: uuid('accepted_version_id')
      .notNull()
      .references(() => contractVersion.id, { onDelete: 'restrict' }),
    status: contractBillingStatus('status').notNull(),
    suspendedReason: contractBillingSuspension('suspended_reason'),
    suspendedAt: timestamp('suspended_at'),
    // Frozen at acceptance (umbrella §6).
    familyFeeBps: integer('family_fee_bps').notNull(),
    providerCommissionBps: integer('provider_commission_bps').notNull(),
    familyProvince: text('family_province').notNull(),
    helperProvince: text('helper_province').notNull(),
    timeZone: text('time_zone').notNull(),
    startsOn: date('starts_on').notNull(),
    // When the contract became billable: acceptance, or the moment a helper
    // who wasn't payment-ready became so. Drives the late-booking rule.
    billableFrom: timestamp('billable_from'),
    // Last calendar date sessions were materialised for (rolling window).
    materialisedThrough: date('materialised_through'),
    remindersSent: jsonb('reminders_sent')
      .$type<Array<string>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    cancelledAt: timestamp('cancelled_at'),
    endedAt: timestamp('ended_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [index('contract_billing_status_idx').on(table.status)]
);

/** A 3-day cycle. Instants are UTC, computed once from the contract zone. */
export const contractCycle = appDb.table(
  'contract_cycles',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contract.id, { onDelete: 'restrict' }),
    index: integer('index').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    startsAt: timestamp('starts_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    holdAt: timestamp('hold_at').notNull(),
    captureAt: timestamp('capture_at').notNull(),
    transferAt: timestamp('transfer_at').notNull(),
    status: contractCycleStatus('status').notNull().default('scheduled'),
    chargeMode: contractCycleChargeMode('charge_mode'),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: timestamp('next_retry_at'),
    paymentId: uuid('payment_id').references(() => payment.id, { onDelete: 'restrict' }),
    // The frozen quote (null until the cycle is quoted).
    carriedInCents: integer('carried_in_cents').notNull().default(0),
    serviceCents: integer('service_cents'),
    serviceTaxCents: integer('service_tax_cents'),
    familyFeeBps: integer('family_fee_bps'),
    familyFeeCents: integer('family_fee_cents'),
    familyFeeTaxCents: integer('family_fee_tax_cents'),
    familyTotalCents: integer('family_total_cents'),
    providerCommissionBps: integer('provider_commission_bps'),
    providerCommissionCents: integer('provider_commission_cents'),
    providerCommissionTaxCents: integer('provider_commission_tax_cents'),
    providerShareCents: integer('provider_share_cents'),
    taxLines: jsonb('tax_lines')
      .$type<Array<CycleTaxLine>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    carriedOutCents: integer('carried_out_cents').notNull().default(0),
    heldCents: integer('held_cents'),
    capturedCents: integer('captured_cents'),
    fundedAt: timestamp('funded_at'),
    capturedAt: timestamp('captured_at'),
    suspendedAt: timestamp('suspended_at'),
    // A resume charges the sessions starting after this instant.
    resumeFrom: timestamp('resume_from'),
    // Notices already sent for this cycle, so a rerun never repeats one.
    noticesSent: jsonb('notices_sent')
      .$type<Array<string>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('contract_cycles_contract_index_uidx').on(table.contractId, table.index),
    index('contract_cycles_status_idx').on(table.status),
    index('contract_cycles_payment_id_idx').on(table.paymentId)
  ]
);

/** One dated session materialised from the accepted weekly pattern. */
export const contractSession = appDb.table(
  'contract_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contract.id, { onDelete: 'restrict' }),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => contractCycle.id, { onDelete: 'restrict' }),
    date: date('date').notNull(),
    // `<serviceId>@<startMinutes>`.
    slot: text('slot').notNull(),
    serviceId: text('service_id').notNull(),
    serviceName: text('service_name').notNull(),
    startMinutes: integer('start_minutes').notNull(),
    endMinutes: integer('end_minutes').notNull(),
    startsAt: timestamp('starts_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    elapsedMinutes: integer('elapsed_minutes').notNull(),
    rateCents: integer('rate_cents').notNull(),
    valueCents: integer('value_cents').notNull(),
    status: contractSessionStatus('status').notNull().default('scheduled'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('contract_sessions_contract_date_slot_uidx').on(
      table.contractId,
      table.date,
      table.slot
    ),
    index('contract_sessions_cycle_id_idx').on(table.cycleId)
  ]
);

/** Every cycle, session, fee and tax amount as its own entry (umbrella §5). */
export const billingLedgerEntry = appDb.table(
  'billing_ledger_entries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contract.id, { onDelete: 'restrict' }),
    cycleId: uuid('cycle_id').references(() => contractCycle.id, { onDelete: 'restrict' }),
    sessionId: uuid('session_id').references(() => contractSession.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id').references(() => payment.id, { onDelete: 'restrict' }),
    // Deterministic, so writing an entry twice is a no-op.
    entryKey: text('entry_key').notNull(),
    kind: billingLedgerKind('kind').notNull(),
    // Who the amount is for: charged to the family, owed to the helper, or
    // kept (or absorbed) by Poppynz.
    party: billingLedgerParty('party').notNull(),
    amountCents: integer('amount_cents').notNull(),
    label: text('label'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('billing_ledger_entries_entry_key_uidx').on(table.entryKey),
    index('billing_ledger_entries_contract_id_idx').on(table.contractId)
  ]
);

/** A Poppynz/Stripe failure after a cycle was represented as funded. */
export const billingIncident = appDb.table(
  'billing_incidents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contract.id, { onDelete: 'restrict' }),
    cycleId: uuid('cycle_id').references(() => contractCycle.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    detail: text('detail').notNull(),
    resolvedAt: timestamp('resolved_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('billing_incidents_cycle_kind_uidx').on(table.cycleId, table.kind),
    index('billing_incidents_contract_id_idx').on(table.contractId)
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
    kind: tcDocumentKind('kind').default('terms').notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('tc_documents_slug_uidx').on(table.slug),
    index('tc_documents_deleted_at_idx').on(table.deletedAt),
    // Signing reads THE service agreement, so there is at most one live one.
    uniqueIndex('tc_documents_service_agreement_uidx')
      .on(table.kind)
      .where(sql`${table.kind} = 'service_agreement' and ${table.deletedAt} is null`)
  ]
);

// Immutable once published (publishedAt set): users accepted that exact text,
// so published rows are never updated or deleted. publishedAt null = the
// document's single open draft per locale, enforced by the partial unique
// index.
//
// Per-locale versions (U7): English is the authoritative text and numbers the
// revisions. A translation is a row in another locale carrying the SAME
// version number as the English revision it translates; it is optional and
// written by a person (legal text is never machine-translated). Readers in a
// locale see the translation of the current revision when one is published,
// otherwise the English text with a notice. Accepting either row accepts
// that revision.
export const tcDocumentVersion = appDb.table(
  'tc_document_versions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => tcDocument.id, { onDelete: 'cascade' }),
    locale: text('locale').default('en').notNull(),
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
    uniqueIndex('tc_document_versions_document_id_locale_version_uidx').on(
      table.documentId,
      table.locale,
      table.version
    ),
    uniqueIndex('tc_document_versions_document_id_locale_draft_uidx')
      .on(table.documentId, table.locale)
      .where(sql`${table.publishedAt} is null`),
    check('tc_document_versions_locale_check', sql`${table.locale} in ('en', 'fr')`)
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

// One party's signature on a contract version's written service agreement
// (UAT round 2, item 4). The row is the evidence: which template revision and
// language was signed, the exact rendered text (content) and its SHA-256, and
// the cancellation policy (Terms of Service revision) in force — so a later
// dispute knows which rules applied. Append-only: a trigger refuses every
// change except voiding, and every delete. Voiding is how a signature stops
// counting — the family's when they withdraw a proposal to edit it (the same
// version row is re-sent and re-signed). At most one live signature per side
// per contract version; both sides' signatures attach to the same version.
export const contractAgreementSignature = appDb.table(
  'contract_agreement_signatures',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contract.id, { onDelete: 'restrict' }),
    contractVersionId: uuid('contract_version_id')
      .notNull()
      .references(() => contractVersion.id, { onDelete: 'restrict' }),
    contractVersion: integer('contract_version').notNull(),
    signerUserId: text('signer_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    signerSide: contractAgreementSigner('signer_side').notNull(),
    templateDocumentId: uuid('template_document_id')
      .notNull()
      .references(() => tcDocument.id, { onDelete: 'restrict' }),
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => tcDocumentVersion.id, { onDelete: 'restrict' }),
    templateVersion: integer('template_version').notNull(),
    locale: text('locale').notNull(),
    content: text('content').notNull(),
    contentSha256: text('content_sha256').notNull(),
    // Null only when no Terms of Service revision was published at signing.
    cancellationPolicyVersionId: uuid('cancellation_policy_version_id').references(
      () => tcDocumentVersion.id,
      { onDelete: 'restrict' }
    ),
    cancellationPolicyVersion: integer('cancellation_policy_version'),
    signedAt: timestamp('signed_at').defaultNow().notNull(),
    voidedAt: timestamp('voided_at')
  },
  (table) => [
    index('contract_agreement_signatures_contract_id_idx').on(table.contractId),
    index('contract_agreement_signatures_template_version_id_idx').on(table.templateVersionId),
    uniqueIndex('contract_agreement_signatures_live_uidx')
      .on(table.contractVersionId, table.signerSide)
      .where(sql`${table.voidedAt} is null`),
    check('contract_agreement_signatures_locale_check', sql`${table.locale} in ('en', 'fr')`),
    check(
      'contract_agreement_signatures_sha256_check',
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`
    )
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
  payments: many(payment),
  checkOrders: many(checkOrder),
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

export const paymentRelations = relations(payment, ({ one }) => ({
  user: one(user, {
    fields: [payment.userId],
    references: [user.id]
  })
}));

export const billingCustomerRelations = relations(billingCustomer, ({ one }) => ({
  user: one(user, {
    fields: [billingCustomer.userId],
    references: [user.id]
  })
}));

export const checkOrderRelations = relations(checkOrder, ({ one, many }) => ({
  items: many(checkOrderItem),
  user: one(user, {
    fields: [checkOrder.userId],
    references: [user.id]
  }),
  payment: one(payment, {
    fields: [checkOrder.paymentId],
    references: [payment.id]
  })
}));

export const checkOrderItemRelations = relations(checkOrderItem, ({ one }) => ({
  order: one(checkOrder, {
    fields: [checkOrderItem.orderId],
    references: [checkOrder.id]
  }),
  documentType: one(kycDocumentType, {
    fields: [checkOrderItem.documentTypeId],
    references: [kycDocumentType.id]
  })
}));

export const safetyVerificationRelations = relations(safetyVerification, ({ one }) => ({
  user: one(user, {
    fields: [safetyVerification.userId],
    references: [user.id],
    relationName: 'safetyVerificationApplicant'
  }),
  checkOrder: one(checkOrder, {
    fields: [safetyVerification.checkOrderId],
    references: [checkOrder.id]
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
