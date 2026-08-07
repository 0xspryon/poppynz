import {
  CreateBucketCommand,
  GetBucketPolicyCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { rustfsConfig } from '@repo/env';
import { Context, Data, Effect, Either, Layer } from 'effect';

export type ObjectStorageConfig = {
  endpoint: string;
  publicEndpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export type PresignedPutInput = {
  bucket: string;
  key: string;
  contentType: string;
  expiresInSeconds: number;
};

export type PresignedPutResult = {
  uploadUrl: string;
  expiresAt: Date;
};

export type PresignedGetInput = {
  bucket: string;
  key: string;
  expiresInSeconds: number;
  // Forwarded as response-content-disposition so viewers render inline
  // instead of triggering a download.
  contentDisposition?: string;
};

export type PresignedGetResult = {
  url: string;
  expiresAt: Date;
};

export class ObjectStorageError extends Data.TaggedError('ObjectStorageError')<{
  operation:
    | 'headBucket'
    | 'createBucket'
    | 'getBucketPolicy'
    | 'putBucketPolicy'
    | 'presignPutObject'
    | 'presignGetObject';
  bucket: string;
  key?: string;
  cause: unknown;
}> {}

export type ObjectStorageFailure = ObjectStorageError;

export class ObjectStorage extends Context.Tag('@repo/objs/ObjectStorage')<
  ObjectStorage,
  {
    ensureBucketExists: (bucket: string) => Effect.Effect<void, ObjectStorageError>;
    ensurePublicReadBucket: (bucket: string) => Effect.Effect<void, ObjectStorageError>;
    createPresignedPutUrl: (
      input: PresignedPutInput
    ) => Effect.Effect<PresignedPutResult, ObjectStorageError>;
    createPresignedGetUrl: (
      input: PresignedGetInput
    ) => Effect.Effect<PresignedGetResult, ObjectStorageError>;
  }
>() {}

const makeS3Client = (config: ObjectStorageConfig, endpoint: string) => {
  const clientConfig: S3ClientConfig = {
    endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  };

  return new S3Client(clientConfig);
};

const isMissingBucketError = (cause: unknown) => {
  if (!cause || typeof cause !== 'object') {
    return false;
  }

  const error = cause as { name?: string; $metadata?: { httpStatusCode?: number } };

  return (
    error.name === 'NotFound' ||
    error.name === 'NoSuchBucket' ||
    error.$metadata?.httpStatusCode === 404
  );
};

const isAlreadyExistsError = (cause: unknown) => {
  if (!cause || typeof cause !== 'object') {
    return false;
  }

  const error = cause as { name?: string; $metadata?: { httpStatusCode?: number } };

  return (
    error.name === 'BucketAlreadyOwnedByYou' ||
    error.name === 'BucketAlreadyExists' ||
    error.$metadata?.httpStatusCode === 409
  );
};

const publicReadPolicy = (bucket: string) =>
  JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`]
      }
    ]
  });

const makeObjectStorage = (config: ObjectStorageConfig): Context.Tag.Service<ObjectStorage> => {
  const internalClient = makeS3Client(config, config.endpoint);
  const publicClient = makeS3Client(config, config.publicEndpoint);

  const ensureBucketExists = (bucket: string) =>
    Effect.tryPromise({
      try: async () => {
        try {
          await internalClient.send(new HeadBucketCommand({ Bucket: bucket }));
          return;
        } catch (cause) {
          if (!isMissingBucketError(cause)) {
            throw new ObjectStorageError({ operation: 'headBucket', bucket, cause });
          }
        }

        try {
          await internalClient.send(new CreateBucketCommand({ Bucket: bucket }));
        } catch (cause) {
          if (isAlreadyExistsError(cause)) {
            return;
          }

          throw new ObjectStorageError({ operation: 'createBucket', bucket, cause });
        }
      },
      catch: (cause) =>
        cause instanceof ObjectStorageError
          ? cause
          : new ObjectStorageError({ operation: 'createBucket', bucket, cause })
    });

  return {
    ensureBucketExists,
    ensurePublicReadBucket: (bucket) =>
      Effect.gen(function* () {
        yield* ensureBucketExists(bucket);

        const desiredPolicy = publicReadPolicy(bucket);
        const currentPolicy = yield* Effect.tryPromise({
          try: () => internalClient.send(new GetBucketPolicyCommand({ Bucket: bucket })),
          catch: (cause) => new ObjectStorageError({ operation: 'getBucketPolicy', bucket, cause })
        }).pipe(Effect.either);

        if (Either.isRight(currentPolicy) && currentPolicy.right.Policy === desiredPolicy) {
          return;
        }

        yield* Effect.tryPromise({
          try: () =>
            internalClient.send(
              new PutBucketPolicyCommand({ Bucket: bucket, Policy: desiredPolicy })
            ),
          catch: (cause) => new ObjectStorageError({ operation: 'putBucketPolicy', bucket, cause })
        });
      }),
    createPresignedPutUrl: (input) =>
      Effect.tryPromise({
        try: async () => {
          const uploadUrl = await getSignedUrl(
            publicClient,
            new PutObjectCommand({
              Bucket: input.bucket,
              Key: input.key,
              ContentType: input.contentType
            }),
            { expiresIn: input.expiresInSeconds }
          );

          return {
            uploadUrl,
            expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000)
          };
        },
        catch: (cause) =>
          new ObjectStorageError({
            operation: 'presignPutObject',
            bucket: input.bucket,
            key: input.key,
            cause
          })
      }),
    createPresignedGetUrl: (input) =>
      Effect.tryPromise({
        try: async () => {
          const url = await getSignedUrl(
            publicClient,
            new GetObjectCommand({
              Bucket: input.bucket,
              Key: input.key,
              ...(input.contentDisposition
                ? { ResponseContentDisposition: input.contentDisposition }
                : {})
            }),
            { expiresIn: input.expiresInSeconds }
          );

          return {
            url,
            expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000)
          };
        },
        catch: (cause) =>
          new ObjectStorageError({
            operation: 'presignGetObject',
            bucket: input.bucket,
            key: input.key,
            cause
          })
      })
  };
};

export const ObjectStorageLive = Layer.effect(
  ObjectStorage,
  rustfsConfig.pipe(Effect.map(makeObjectStorage))
);

export const makeObjectStorageTest = (implementation: Context.Tag.Service<ObjectStorage>) =>
  Layer.succeed(ObjectStorage, implementation);
