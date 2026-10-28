import { Config, ConfigError, Either } from 'effect';

export const appEnvironments = ['dev', 'staging', 'production'] as const;
export type AppEnvironment = (typeof appEnvironments)[number];

const isAppEnvironment = (value: string): value is AppEnvironment =>
  (appEnvironments as ReadonlyArray<string>).includes(value);

// Which deployment this process runs in. Gates outbound mail (see mailConfig);
// defaults to "dev" so a missing variable can never mass-mail real users.
export const environmentConfig = Config.string('ENVIRONMENT').pipe(
  Config.withDefault('dev'),
  Config.mapOrFail((raw) => {
    const value = raw.trim().toLowerCase();
    return isAppEnvironment(value)
      ? Either.right(value)
      : Either.left(
        ConfigError.InvalidData(
          [],
          `ENVIRONMENT must be one of: ${appEnvironments.join(', ')} — got "${raw}"`
        )
      );
  })
);

const adminAccountsList = Config.string('ADMIN_ACCOUNTS').pipe(
  Config.withDefault('springfield@poppynz.com;kay@poppynz.com'),
  Config.map((raw) =>
    raw
      .split(';')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  )
);

export const adminAccountConfig = Config.all({
  adminAccounts: adminAccountsList
});

// Semicolon-separated UI origins allowed as magic-link callback targets.
// Defaults cover the dev web (5173) and admin (5174) apps.
export const trustedOriginsConfig = Config.all({
  trustedOrigins: Config.string('TRUSTED_ORIGINS').pipe(
    Config.withDefault('https://poppynz.com;https://app.poppynz.com')
  )
});

export const rustfsConfig = Config.all({
  endpoint: Config.string('RUSTFS_ENDPOINT'),
  publicEndpoint: Config.string('RUSTFS_PUBLIC_ENDPOINT'),
  accessKeyId: Config.string('RUSTFS_ACCESS_KEY'),
  secretAccessKey: Config.string('RUSTFS_SECRET_KEY'),
  region: Config.string('RUSTFS_REGION').pipe(Config.withDefault('us-east-1'))
});

export const objectBucketsConfig = Config.all({
  kycBucket: Config.string('OBJS_KYC_BUCKET'),
  publicBucket: Config.string('OBJS_PUBLIC_BUCKET')
});

export const objectStorageConfig = Config.all({
  rustfs: rustfsConfig,
  buckets: objectBucketsConfig
});

export const googleMapsConfig = Config.all({
  apiKey: Config.string('GOOGLE_MAPS_API_KEY')
});

export const redisConfig = Config.all({
  url: Config.string('REDIS_URL').pipe(Config.withDefault('redis://127.0.0.1:6379'))
});

// How long an ignored reach-out blocks the pair. Within the window the ignore
// stays invisible to the sender (thread reads as pending); past it the pair is
// treated as if it never existed and either side may reach out afresh.
export const reachoutConfig = Config.all({
  ignoreCooldownDays: Config.integer('REACHOUT_IGNORE_COOLDOWN_DAYS').pipe(Config.withDefault(120))
});

// How long a sent contract proposal (or amendment) stays acceptable. Past the
// window it presents as expired and accept is refused — declining, withdrawing
// and re-proposing remain possible. Computed at read time, no cron.
export const contractConfig = Config.all({
  proposalExpiryDays: Config.integer('CONTRACT_PROPOSAL_EXPIRY_DAYS').pipe(Config.withDefault(14))
});

export const typesenseConfig = Config.all({
  host: Config.string('TYPESENSE_HOST'),
  port: Config.integer('TYPESENSE_PORT'),
  protocol: Config.string('TYPESENSE_PROTOCOL').pipe(Config.withDefault('http')),
  apiKey: Config.string('TYPESENSE_API_KEY'),
  providerCollection: Config.string('TYPESENSE_PROVIDER_COLLECTION').pipe(
    Config.withDefault('service_providers')
  ),
  providerCollectionAlias: Config.string('TYPESENSE_PROVIDER_COLLECTION_ALIAS').pipe(
    Config.withDefault('service_providers_current')
  ),
  providerCollectionVersion: Config.string('TYPESENSE_PROVIDER_COLLECTION_VERSION').pipe(
    Config.withDefault('service_providers_v1')
  ),
  familyCollection: Config.string('TYPESENSE_FAMILY_COLLECTION').pipe(
    Config.withDefault('families')
  ),
  familyCollectionAlias: Config.string('TYPESENSE_FAMILY_COLLECTION_ALIAS').pipe(
    Config.withDefault('families_current')
  ),
  // v2 adds `verifiedUntil` (families are gated on safety verification).
  familyCollectionVersion: Config.string('TYPESENSE_FAMILY_COLLECTION_VERSION').pipe(
    Config.withDefault('families_v2')
  )
});

export const providerSearchConfig = Config.all({
  minRadiusKm: Config.integer('PROVIDER_SEARCH_MIN_RADIUS_KM').pipe(Config.withDefault(10))
});

export const familySearchConfig = Config.all({
  minRadiusKm: Config.integer('FAMILY_SEARCH_MIN_RADIUS_KM').pipe(Config.withDefault(10))
});

export const servicesOfferedConfig = Config.all({
  maxPerProvider: Config.integer('SERVICES_OFFERED_MAX_PER_PROVIDER').pipe(Config.withDefault(20))
});

export const servicesNeededConfig = Config.all({
  maxPerFamily: Config.integer('SERVICES_NEEDED_MAX_PER_FAMILY').pipe(Config.withDefault(20))
});

// Without RESEND_API_KEY the mailer stays in dev log-mode: deliveries are
// written to stdout (the magic-link sign-in recipe depends on that).
// With a key, ENVIRONMENT gates who actually receives mail: production sends
// to everyone; staging only to @poppynz.com addresses and the admin accounts;
// dev applies the staging rule and additionally logs every mail to stdout.
// ADMIN_NOTIFICATION_EMAILS is the comma-separated subset of admin accounts
// that receive review-queue notifications; empty means notify nobody.
export const mailConfig = Config.all({
  resendApiKey: Config.option(Config.string('RESEND_API_KEY')),
  from: Config.string('MAIL_FROM').pipe(Config.withDefault('Poppynz <no-reply@poppynz.com>')),
  adminNotificationEmails: Config.string('ADMIN_NOTIFICATION_EMAILS').pipe(
    Config.withDefault(''),
    Config.map((raw) =>
      raw
        .split(';')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  ),
  environment: environmentConfig,
  adminAccounts: adminAccountsList
});

// Credibled — the screening vendor behind Path A of safety verification.
//
// Keys and webhook secrets are Redacted so they can't leak into a log line or
// an error message by accident; read them with `Redacted.value` at the call
// site only. Each Credibled AUDIENCE (helpers, families) is a separate account
// with its own key and its own webhook secret, and their webhook payload
// identifies neither — so the one shared webhook endpoint tries each secret
// and takes the audience from the order the check belongs to.
//
// Without an API key the client stays in dev log-mode: orders are logged and
// answered with a synthetic check id instead of being sent (and paid for).
export const credibledConfig = Config.all({
  baseUrl: Config.string('CREDIBLED_BASE_URL').pipe(
    Config.withDefault('https://api.credibled.com/api/external/v1')
  ),
  providerApiKey: Config.option(Config.redacted('CREDIBLED_PROVIDER_API_KEY')),
  providerWebhookSecret: Config.option(Config.redacted('CREDIBLED_PROVIDER_WEBHOOK_SECRET')),
  // The family account isn't wired up yet; both stay empty until its key is
  // issued, at which point enabling it is configuration rather than code.
  familyApiKey: Config.option(Config.redacted('CREDIBLED_PROVIDER_API_KEY')),
  familyWebhookSecret: Config.option(Config.redacted('CREDIBLED_PROVIDER_WEBHOOK_SECRET')),
  requestTimeoutMillis: Config.integer('CREDIBLED_REQUEST_TIMEOUT_MS').pipe(
    Config.withDefault(15000)
  )
});

// Poppynz safety verification policy.
//
// `validityMonths` exists because Credibled reports completion but never an
// expiry date — how long a passed check stays good is our decision, not
// theirs. Uploaded documents carry their own valid-until date and ignore it.
export const safetyVerificationConfig = Config.all({
  validityMonths: Config.integer('SAFETY_VERIFICATION_VALIDITY_MONTHS').pipe(
    Config.withDefault(12)
  ),
  expiryReminderDays: Config.integer('SAFETY_VERIFICATION_EXPIRY_REMINDER_DAYS').pipe(
    Config.withDefault(30)
  ),
  // Stamped onto the consent record so a later policy change can't rewrite
  // what an applicant actually agreed to.
  consentPolicyVersion: Config.string('SAFETY_VERIFICATION_CONSENT_POLICY_VERSION').pipe(
    Config.withDefault('2026-08-22')
  ),
  // Credibled's API exposes no pricing, so the vendor cost is configured
  // rather than quoted. Both are pre-tax, in cents.
  // The price applied to a Credibled check when the document type has no
  // explicit one. Per-type prices on kyc_document_types override it.
  checkCostCents: Config.integer('SAFETY_VERIFICATION_CHECK_COST_CENTS').pipe(
    Config.withDefault(5500)
  ),
  adminFeeCents: Config.integer('SAFETY_VERIFICATION_ADMIN_FEE_CENTS').pipe(
    Config.withDefault(500)
  ),
  // Sales tax is not configured here: it is resolved from the tax
  // configuration tables at quote time (piece 3 spec §3a).
  // Order attempts after a successful payment before the charge is refunded.
  orderMaxAttempts: Config.integer('SAFETY_VERIFICATION_ORDER_MAX_ATTEMPTS').pipe(
    Config.withDefault(3)
  )
});

// Stripe — card payments (piece 2a of the contract-billing design).
//
// PAYMENTS_PROVIDER picks the gateway for the API and the worker alike and
// defaults to `mock`, so a checkout without Stripe keys keeps working and
// never charges anything. With `stripe` the secret key is required and must
// be a TEST-mode key: live activation is a separate, deliberate step
// (docs/activating-stripe-connect.md). Both secrets are Redacted — read them
// with `Redacted.value` at the call site only.
//
// A payment left unconfirmed (tab closed mid-3-D Secure, webhook lost) is
// re-fetched by the worker after PAYMENTS_SETTLE_AFTER_MINUTES and cancelled
// after PAYMENTS_ABANDON_AFTER_HOURS, which returns its order to the basket.
export const stripeConfig = Config.all({
  provider: Config.literal('mock', 'stripe')('PAYMENTS_PROVIDER').pipe(
    Config.withDefault('mock' as const)
  ),
  secretKey: Config.option(Config.redacted('STRIPE_SECRET_KEY')),
  webhookSecret: Config.option(Config.redacted('STRIPE_WEBHOOK_SECRET')),
  // The Connect endpoint's signing secret (account.updated on connected
  // accounts). Optional: locally `stripe listen` signs both streams with
  // STRIPE_WEBHOOK_SECRET.
  connectWebhookSecret: Config.option(Config.redacted('STRIPE_CONNECT_WEBHOOK_SECRET')),
  settleAfterMinutes: Config.integer('PAYMENTS_SETTLE_AFTER_MINUTES').pipe(Config.withDefault(10)),
  abandonAfterHours: Config.integer('PAYMENTS_ABANDON_AFTER_HOURS').pipe(Config.withDefault(24))
});

// Contract billing (piece 3). The commissions are frozen on each contract at
// acceptance; changing them only affects contracts accepted afterwards.
// Sales tax is NOT configured here — it is database state (tax_* tables).
// A malformed value is a ConfigError, never a silent default: billing a
// contract at the wrong commission is worse than not billing it.
const basisPoints = (name: string, fallback: number) =>
  Config.integer(name).pipe(
    Config.withDefault(fallback),
    Config.validate({
      message: `${name} must be a whole number of basis points between 0 and 10000`,
      validation: (value) => value >= 0 && value <= 10_000
    })
  );

export const contractBillingConfig = Config.all({
  familyCommissionBps: basisPoints('CONTRACT_FAMILY_COMMISSION_BPS', 500),
  providerCommissionBps: basisPoints('CONTRACT_PROVIDER_COMMISSION_BPS', 1500),
  // How often a declined hold is retried during its grace period (it is also
  // retried at once whenever the family replaces the card).
  retryHours: Config.integer('CONTRACT_BILLING_RETRY_HOURS').pipe(
    Config.withDefault(12),
    Config.validate({
      message: 'CONTRACT_BILLING_RETRY_HOURS must be a whole number of hours, at least 1',
      validation: (value) => value >= 1
    })
  ),
  // How long before a cycle starts (00:00 on its first day, contract zone)
  // its amount is held on the family's card; the grace period after a
  // declined hold runs from the hold to the cycle start. UAT round 2: 1 day
  // (was 2). Read when a cycle is planned — cycles already planned keep the
  // hold_at they were stored with.
  holdLeadHours: Config.integer('CONTRACT_HOLD_LEAD_HOURS').pipe(
    Config.withDefault(24),
    Config.validate({
      message: 'CONTRACT_HOLD_LEAD_HOURS must be a whole number of hours between 1 and 72',
      validation: (value) => value >= 1 && value <= 72
    })
  ),
  // UAT round 2: terms can be sent and accepted until this long before the
  // FIRST session starts (contract zone). At least an hour: a booking this
  // late is charged at once, and the charge must land before care begins.
  minLeadMinutes: Config.integer('CONTRACT_MIN_LEAD_MINUTES').pipe(
    Config.withDefault(120),
    Config.validate({
      message: 'CONTRACT_MIN_LEAD_MINUTES must be a whole number of minutes between 60 and 10080',
      validation: (value) => value >= 60 && value <= 10_080
    })
  ),
  // Dated sessions exist this many days ahead (the rolling materialisation
  // window, contract billing §1). Session actions (cancel, day off, reports)
  // act only on sessions that exist, and the UI explains the window with this
  // number. Was the SESSION_WINDOW_DAYS constant.
  sessionWindowDays: Config.integer('CONTRACT_SESSION_WINDOW_DAYS').pipe(
    Config.withDefault(14),
    Config.validate({
      message: 'CONTRACT_SESSION_WINDOW_DAYS must be a whole number of days between 1 and 60',
      validation: (value) => value >= 1 && value <= 60
    })
  )
});

const wholeHours = (name: string, fallback: number, min: number, max: number) =>
  Config.integer(name).pipe(
    Config.withDefault(fallback),
    Config.validate({
      message: `${name} must be a whole number of hours between ${min} and ${max}`,
      validation: (value) => value >= min && value <= max
    })
  );

// Session resolution (Tier 3, spec 2026-10-28 §3a, §6). Same posture as
// contract billing: a malformed value is a ConfigError, never a silent
// default — classifying a cancellation by the wrong cutoff is worse than not
// accepting it until the setting is fixed.
export const sessionResolutionConfig = Config.all({
  // A family cancellation recorded at least this long before the session
  // starts (same wall-clock time, contract zone) is early, i.e. free.
  // Unanswered day-off proposals lapse at that same cutoff.
  cancellationNoticeHours: wholeHours('CONTRACT_CANCELLATION_NOTICE_HOURS', 24, 1, 168),
  // How long the other side has to accept or contest a one-sided report;
  // silence past it counts as acceptance.
  reportResponseHours: wholeHours('CONTRACT_REPORT_RESPONSE_HOURS', 48, 1, 336),
  // How long after a session ends a report or dispute may still be filed.
  reportWindowHours: wholeHours('CONTRACT_REPORT_WINDOW_HOURS', 48, 1, 336),
  // The share of a late-cancelled session's cancelled care value paid to the
  // helper as compensation (rounded half up for the helper; spec §6).
  lateCancellationHelperBps: basisPoints('CONTRACT_LATE_CANCELLATION_HELPER_BPS', 2500)
});

// Card disputes (chargebacks, Tier 3 step 4, spec 2026-10-28 §15). Same
// posture: a malformed value is a ConfigError, never a silent default — a
// missed evidence deadline loses the dispute.
export const cardDisputeConfig = Config.all({
  // The admins are reminded this many hours before a dispute's evidence is
  // due at the bank (Stripe's `evidence_due_by`) while none was submitted.
  evidenceReminderHours: wholeHours('CONTRACT_DISPUTE_EVIDENCE_REMINDER_HOURS', 72, 1, 720),
  // The evidence pack quotes the contract's messages from this many days
  // before the first disputed session up to the dispute.
  evidenceMessageDays: Config.integer('CONTRACT_DISPUTE_EVIDENCE_MESSAGE_DAYS').pipe(
    Config.withDefault(14),
    Config.validate({
      message: 'CONTRACT_DISPUTE_EVIDENCE_MESSAGE_DAYS must be a whole number of days between 1 and 365',
      validation: (value) => value >= 1 && value <= 365
    })
  ),
  // At most this many messages (the latest) are quoted: the bank reads a
  // summary, and Stripe caps the evidence's size.
  evidenceMaxMessages: Config.integer('CONTRACT_DISPUTE_EVIDENCE_MAX_MESSAGES').pipe(
    Config.withDefault(60),
    Config.validate({
      message: 'CONTRACT_DISPUTE_EVIDENCE_MAX_MESSAGES must be a whole number between 1 and 500',
      validation: (value) => value >= 1 && value <= 500
    })
  )
});

// Session money and helper transfers (Tier 3 step 2, spec 2026-10-28 §7–§8).
// Same posture: a malformed value is a ConfigError, never a silent default.
export const sessionMoneyConfig = Config.all({
  // Each cycle's transfer to the helper is made this long after the cycle
  // ends (00:00 after its last day, contract zone), once every session is
  // past its report window. Read when a cycle is planned: cycles already
  // planned keep the transfer_at they were stored with.
  transferDelayHours: wholeHours('CONTRACT_TRANSFER_DELAY_HOURS', 48, 0, 336),
  // A payable that could not be transferred (the helper's payout account is
  // restricted or not ready) moves to the admins' manual payout queue this
  // many days after its transfer was due.
  manualPayoutAfterDays: Config.integer('CONTRACT_MANUAL_PAYOUT_AFTER_DAYS').pipe(
    Config.withDefault(60),
    Config.validate({
      message: 'CONTRACT_MANUAL_PAYOUT_AFTER_DAYS must be a whole number of days between 1 and 365',
      validation: (value) => value >= 1 && value <= 365
    })
  ),
  // How many times a refund the provider could not be reached for is
  // retried (one try per tick) before the admins and accountant are alerted.
  // It keeps being retried after that; the alert is sent once.
  refundAlertAfterAttempts: Config.integer('CONTRACT_REFUND_ALERT_AFTER_ATTEMPTS').pipe(
    Config.withDefault(8),
    Config.validate({
      message: 'CONTRACT_REFUND_ALERT_AFTER_ATTEMPTS must be a whole number between 1 and 1000',
      validation: (value) => value >= 1 && value <= 1000
    })
  )
});

// Extra sessions (Tier 3 step 3, spec 2026-10-28 §1 step 3, §12 decision 4).
// Same posture: a malformed value is a ConfigError, never a silent default —
// charging an extra session at the wrong moment is worse than not offering
// extra sessions until the setting is fixed.
export const extraSessionConfig = Config.all({
  // How far back an extra session may be dated (a session that took place):
  // today minus this many days, in the contract zone (decision 4: 14).
  lookbackDays: Config.integer('CONTRACT_EXTRA_SESSION_LOOKBACK_DAYS').pipe(
    Config.withDefault(14),
    Config.validate({
      message: 'CONTRACT_EXTRA_SESSION_LOOKBACK_DAYS must be a whole number of days between 0 and 60',
      validation: (value) => value >= 0 && value <= 60
    })
  ),
  // Once both sides agreed, the charge waits this long; either side may
  // cancel the extra session at no cost until then.
  chargeDelayMinutes: Config.integer('CONTRACT_EXTRA_SESSION_CHARGE_DELAY_MINUTES').pipe(
    Config.withDefault(60),
    Config.validate({
      message:
        'CONTRACT_EXTRA_SESSION_CHARGE_DELAY_MINUTES must be a whole number of minutes between 0 and 1440',
      validation: (value) => value >= 0 && value <= 1440
    })
  ),
  // An extra session's own charge still unpaid this many days after it was
  // due raises an admin incident (once).
  unpaidAlertDays: Config.integer('CONTRACT_EXTRA_SESSION_UNPAID_ALERT_DAYS').pipe(
    Config.withDefault(7),
    Config.validate({
      message:
        'CONTRACT_EXTRA_SESSION_UNPAID_ALERT_DAYS must be a whole number of days between 1 and 90',
      validation: (value) => value >= 1 && value <= 90
    })
  ),
  // A declined extra-session charge is retried every
  // CONTRACT_BILLING_RETRY_HOURS, at most this many automatic attempts in
  // all; replacing the card always retries it at once.
  maxChargeAttempts: Config.integer('CONTRACT_EXTRA_SESSION_MAX_CHARGE_ATTEMPTS').pipe(
    Config.withDefault(15),
    Config.validate({
      message:
        'CONTRACT_EXTRA_SESSION_MAX_CHARGE_ATTEMPTS must be a whole number between 1 and 100',
      validation: (value) => value >= 1 && value <= 100
    })
  ),
  // The shortest extra session that may be proposed, in minutes.
  minMinutes: Config.integer('CONTRACT_EXTRA_SESSION_MIN_MINUTES').pipe(
    Config.withDefault(15),
    Config.validate({
      message: 'CONTRACT_EXTRA_SESSION_MIN_MINUTES must be a whole number of minutes between 1 and 720',
      validation: (value) => value >= 1 && value <= 720
    })
  )
});

// Helper payout accounts (Stripe Connect, piece 2b).
// APP_WEB_ORIGIN is the ONE web origin Stripe's hosted onboarding returns to;
// TRUSTED_ORIGINS is a list, so it can't serve as a single return address.
// A stored payout status older than PAYOUTS_REFRESH_AFTER_MINUTES is
// re-fetched from the provider when read.
export const payoutsConfig = Config.all({
  appWebOrigin: Config.string('APP_WEB_ORIGIN').pipe(
    Config.withDefault('https://app.poppynz.com'),
    Config.map((origin) => origin.trim().replace(/\/+$/, ''))
  ),
  refreshAfterMinutes: Config.integer('PAYOUTS_REFRESH_AFTER_MINUTES').pipe(
    Config.withDefault(60)
  )
});
