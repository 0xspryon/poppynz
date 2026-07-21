import { Config } from "effect";

export const adminAccountConfig = Config.all({
  adminAccounts: Config.string("adminAccounts").pipe(Config.withDefault('springfield@poppynz.com;kay@poppynz.com')),
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
