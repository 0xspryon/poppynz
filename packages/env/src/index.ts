import { Config } from "effect";

export const adminAccountConfig = Config.all({
  adminAccounts: Config.string("ADMIN_ACCOUNTS").pipe(Config.withDefault('springfield@poppynz.com;kay@poppynz.com')),
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

export const typesenseConfig = Config.all({
  host: Config.string("TYPESENSE_HOST"),
  port: Config.integer("TYPESENSE_PORT"),
  protocol: Config.string("TYPESENSE_PROTOCOL").pipe(Config.withDefault("http")),
  apiKey: Config.string("TYPESENSE_API_KEY"),
  providerCollection: Config.string("TYPESENSE_PROVIDER_COLLECTION").pipe(Config.withDefault("service_providers")),
  providerCollectionAlias: Config.string("TYPESENSE_PROVIDER_COLLECTION_ALIAS").pipe(Config.withDefault("service_providers_current")),
  providerCollectionVersion: Config.string("TYPESENSE_PROVIDER_COLLECTION_VERSION").pipe(Config.withDefault("service_providers_v1")),
});

export const providerSearchConfig = Config.all({
  minRadiusKm: Config.integer("PROVIDER_SEARCH_MIN_RADIUS_KM").pipe(Config.withDefault(10)),
});

export const servicesOfferedConfig = Config.all({
  maxPerProvider: Config.integer("SERVICES_OFFERED_MAX_PER_PROVIDER").pipe(Config.withDefault(20)),
});

// Without RESEND_API_KEY the mailer stays in dev log-mode: deliveries are
// written to stdout (the magic-link sign-in recipe depends on that).
// ADMIN_NOTIFICATION_EMAILS is the comma-separated subset of admin accounts
// that receive review-queue notifications; empty means notify nobody.
export const mailConfig = Config.all({
  resendApiKey: Config.option(Config.string("RESEND_API_KEY")),
  from: Config.string("MAIL_FROM").pipe(Config.withDefault("Poppynz <no-reply@poppynz.com>")),
  adminNotificationEmails: Config.string("ADMIN_NOTIFICATION_EMAILS").pipe(
    Config.withDefault(""),
    Config.map((raw) => raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
  ),
});
