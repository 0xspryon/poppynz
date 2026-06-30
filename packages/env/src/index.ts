import { Config } from "effect";

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
