import { objectBucketsConfig } from '@repo/env';
import { ObjectStorage, type ObjectStorageError } from '@repo/objs';
import type { ConfigError } from 'effect/ConfigError';
import { Data, Effect } from 'effect';

export class ProfileImageUrlError extends Data.TaggedError('ProfileImageUrlError')<{
  cause: ObjectStorageError | ConfigError;
}> {}

// Presigned view links are minted per response; clients must treat them as
// short-lived and never cache or persist them.
const imageViewUrlTtlSeconds = 5 * 60;

export const mapProfileImageError = <A, R>(
  effect: Effect.Effect<A, ObjectStorageError | ConfigError, R>
): Effect.Effect<A, ProfileImageUrlError, R> =>
  effect.pipe(Effect.mapError((cause) => new ProfileImageUrlError({ cause })));

// Swaps a stored rustfs file key for a short-lived authorized URL. Responses
// must only ever carry the URL — the raw key stays server-side.
export const presignProfileImageUrl = (
  imageKey: string | null | undefined
): Effect.Effect<string | null, ProfileImageUrlError, ObjectStorage> =>
  Effect.gen(function* () {
    if (!imageKey) return null;

    const objectStorage = yield* ObjectStorage;
    const buckets = yield* objectBucketsConfig.pipe((errors) => mapProfileImageError(errors));
    const presigned = yield* objectStorage
      .createPresignedGetUrl({
        bucket: buckets.publicBucket,
        key: imageKey,
        expiresInSeconds: imageViewUrlTtlSeconds,
        contentDisposition: 'inline'
      })
      .pipe((errors) => mapProfileImageError(errors));

    return presigned.url;
  });
