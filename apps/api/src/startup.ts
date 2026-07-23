import { objectBucketsConfig } from "@repo/env";
import { ObjectStorage } from "@repo/objs";
import { Effect } from "effect";

// Database seeding is NOT done here — @repo/seeder owns it (the `seeds`
// compose service, tracked per-database like migrations).
export const ensureInitialAppState = Effect.gen(function*() {
  const objectStorage = yield* ObjectStorage;
  const { kycBucket, publicBucket } = yield* objectBucketsConfig;
  yield* objectStorage.ensureBucketExists(kycBucket);
  yield* objectStorage.ensurePublicReadBucket(publicBucket);
});
