import { objectBucketsConfig } from "@repo/env";
import { ObjectStorage } from "@repo/objs";
import { Effect } from "effect";

export const ensureInitialAppState = Effect.gen(function* () {
  const objectStorage = yield* ObjectStorage;
  const { kycBucket, publicBucket } = yield* objectBucketsConfig;

  yield* objectStorage.ensureBucketExists(kycBucket);
  yield* objectStorage.ensurePublicReadBucket(publicBucket);
});
