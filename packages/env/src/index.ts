import { Config, ConfigError, Either } from "effect";

export const appEnvironments = ["dev", "staging", "production"] as const;
export type AppEnvironment = (typeof appEnvironments)[number];

const isAppEnvironment = (value: string): value is AppEnvironment =>
  (appEnvironments as ReadonlyArray<string>).includes(value);

// Which deployment this process runs in. Gates outbound mail (see mailConfig);
// defaults to "dev" so a missing variable can never mass-mail real users.
export const environmentConfig = Config.string("ENVIRONMENT").pipe(
  Config.withDefault("dev"),
  Config.mapOrFail((raw) => {
    const value = raw.trim().toLowerCase();
    return isAppEnvironment(value)
      ? Either.right(value)
      : Either.left(
        ConfigError.InvalidData([], `ENVIRONMENT must be one of: ${appEnvironments.join(", ")} — got "${raw}"`),
      );
  }),
);

const adminAccountsList = Config.string("ADMIN_ACCOUNTS").pipe(
  Config.withDefault('springfield@poppynz.com;kay@poppynz.com'),
  Config.map(
    (raw) => raw.split(";").map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0)
  ),
);

export const adminAccountConfig = Config.all({
  adminAccounts: adminAccountsList,
});

// Semicolon-separated UI origins allowed as magic-link callback targets.
// Defaults cover the dev web (5173) and admin (5174) apps.
export const trustedOriginsConfig = Config.all({
  trustedOrigins: Config.string("TRUSTED_ORIGINS").pipe(
    Config.withDefault("https://poppynz.com;https://app.poppynz.com"),
  ),
});

export const rustfsConfig = Config.all({
  endpoint: Config.string("RUSTFS_ENDPOINT"),
  publicEndpoint: Config.string("RUSTFS_PUBLIC_ENDPOINT"),
  accessKeyId: Config.string("RUSTFS_ACCESS_KEY"),
  secretAccessKey: Config.string("RUSTFS_SECRET_KEY"),
  region: Config.string("RUSTFS_REGION").pipe(Config.withDefault("us-east-1")),
});

export const objectBucketsConfig = Config.all({
  kycBucket: Config.string("OBJS_KYC_BUCKET"),
  publicBucket: Config.string("OBJS_PUBLIC_BUCKET"),
});

export const objectStorageConfig = Config.all({
  rustfs: rustfsConfig,
  buckets: objectBucketsConfig,
});

export const googleMapsConfig = Config.all({
  apiKey: Config.string("GOOGLE_MAPS_API_KEY"),
});

export const redisConfig = Config.all({
  url: Config.string("REDIS_URL").pipe(Config.withDefault("redis://127.0.0.1:6379")),
});

// How long an ignored reach-out blocks the pair. Within the window the ignore
// stays invisible to the sender (thread reads as pending); past it the pair is
// treated as if it never existed and either side may reach out afresh.
export const reachoutConfig = Config.all({
  ignoreCooldownDays: Config.integer("REACHOUT_IGNORE_COOLDOWN_DAYS").pipe(Config.withDefault(120)),
});

export const typesenseConfig = Config.all({
  host: Config.string("TYPESENSE_HOST"),
  port: Config.integer("TYPESENSE_PORT"),
  protocol: Config.string("TYPESENSE_PROTOCOL").pipe(Config.withDefault("http")),
  apiKey: Config.string("TYPESENSE_API_KEY"),
  providerCollection: Config.string("TYPESENSE_PROVIDER_COLLECTION").pipe(Config.withDefault("service_providers")),
  providerCollectionAlias: Config.string("TYPESENSE_PROVIDER_COLLECTION_ALIAS").pipe(Config.withDefault("service_providers_current")),
  providerCollectionVersion: Config.string("TYPESENSE_PROVIDER_COLLECTION_VERSION").pipe(Config.withDefault("service_providers_v1")),
  familyCollection: Config.string("TYPESENSE_FAMILY_COLLECTION").pipe(Config.withDefault("families")),
  familyCollectionAlias: Config.string("TYPESENSE_FAMILY_COLLECTION_ALIAS").pipe(Config.withDefault("families_current")),
  familyCollectionVersion: Config.string("TYPESENSE_FAMILY_COLLECTION_VERSION").pipe(Config.withDefault("families_v1")),
});

export const providerSearchConfig = Config.all({
  minRadiusKm: Config.integer("PROVIDER_SEARCH_MIN_RADIUS_KM").pipe(Config.withDefault(10)),
});

export const familySearchConfig = Config.all({
  minRadiusKm: Config.integer("FAMILY_SEARCH_MIN_RADIUS_KM").pipe(Config.withDefault(10)),
});

export const servicesOfferedConfig = Config.all({
  maxPerProvider: Config.integer("SERVICES_OFFERED_MAX_PER_PROVIDER").pipe(Config.withDefault(20)),
});

export const servicesNeededConfig = Config.all({
  maxPerFamily: Config.integer("SERVICES_NEEDED_MAX_PER_FAMILY").pipe(Config.withDefault(20)),
});

// Without RESEND_API_KEY the mailer stays in dev log-mode: deliveries are
// written to stdout (the magic-link sign-in recipe depends on that).
// With a key, ENVIRONMENT gates who actually receives mail: production sends
// to everyone; staging only to @poppynz.com addresses and the admin accounts;
// dev applies the staging rule and additionally logs every mail to stdout.
// ADMIN_NOTIFICATION_EMAILS is the comma-separated subset of admin accounts
// that receive review-queue notifications; empty means notify nobody.
export const mailConfig = Config.all({
  resendApiKey: Config.option(Config.string("RESEND_API_KEY")),
  from: Config.string("MAIL_FROM").pipe(Config.withDefault("Poppynz <no-reply@poppynz.com>")),
  adminNotificationEmails: Config.string("ADMIN_NOTIFICATION_EMAILS").pipe(
    Config.withDefault(""),
    Config.map((raw) => raw.split(";").map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
  ),
  environment: environmentConfig,
  adminAccounts: adminAccountsList,
});
