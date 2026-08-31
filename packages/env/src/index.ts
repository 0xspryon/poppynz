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
  familyCollectionVersion: Config.string('TYPESENSE_FAMILY_COLLECTION_VERSION').pipe(
    Config.withDefault('families_v1')
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
// identifies neither — which is why each audience gets its own webhook path
// rather than one shared endpoint that would have to guess at the secret.
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
  // Placeholder until Stripe Tax lands: Canadian rates run from 5% GST to 15%
  // HST and vary by province, which the payment PR resolves properly.
  taxRateBasisPoints: Config.integer('SAFETY_VERIFICATION_TAX_RATE_BASIS_POINTS').pipe(
    Config.withDefault(0)
  ),
  // Order attempts after a successful payment before the charge is refunded.
  orderMaxAttempts: Config.integer('SAFETY_VERIFICATION_ORDER_MAX_ATTEMPTS').pipe(
    Config.withDefault(3)
  )
});
