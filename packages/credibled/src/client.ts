import { credibledConfig } from '@repo/env';
import { Context, Data, Effect, Layer, Option, Redacted } from 'effect';
import { isCredibledCheckTypeValue, type CredibledCheckTypeValue } from './check-types';

/** Credibled issues one account per audience, each with its own API key,
 * its own check-type uuids and its own webhook secret. */
export type CredibledAudience = 'service-provider' | 'family';

/** Credibled's own application statuses, verbatim. Mapping these onto Poppynz
 * statuses is deliberately NOT done here — see the safety-verification
 * domain, where a PASS still requires a human decision. */
export const credibledApplicationStatuses = [
  'Waiting On Candidate',
  'In Progress',
  'Complete',
  'Action Required',
  'Cancelled',
  'In Dispute'
] as const;
export type CredibledApplicationStatus = (typeof credibledApplicationStatuses)[number];

export type CredibledCheckStatus = {
  readonly uuid: string;
  readonly applicationStatus: string;
  readonly checkStatuses: ReadonlyArray<{
    readonly checkTypeName: string;
    readonly status: string;
    readonly score: string | null;
  }>;
};

export type CredibledCreatedCheck = {
  readonly uuid: string;
  readonly email: string;
  readonly applicationStatus: string;
  /** Credibled-hosted link we surface to the applicant. Preferred over the
   * raw Certn `application_url`. */
  readonly applicationUrl: string | null;
};

export class CredibledNotConfiguredError extends Data.TaggedError('CredibledNotConfiguredError')<{
  audience: CredibledAudience;
}> { }

export class CredibledRequestError extends Data.TaggedError('CredibledRequestError')<{
  operation: 'listCheckTypes' | 'createCheck' | 'checkStatus' | 'reportPdf';
  status: number | null;
  cause: unknown;
}> { }

export class CredibledUnknownCheckTypeError extends Data.TaggedError(
  'CredibledUnknownCheckTypeError'
)<{ value: string }> { }

/** Credibled returns 409 with the existing check when an equivalent one is
 * already open for the same email on the same account. That's a success for
 * our purposes — we adopt the check it points at rather than paying twice. */
export class CredibledDuplicateCheckError extends Data.TaggedError('CredibledDuplicateCheckError')<{
  existingUuid: string | null;
}> { }

export class Credibled extends Context.Tag('@repo/credibled/Credibled')<
  Credibled,
  {
    /** True when the audience has a key — callers gate ordering on this
     * rather than discovering it as a failure mid-payment. */
    isConfigured: (audience: CredibledAudience) => boolean;
    createBackgroundCheck: (input: {
      audience: CredibledAudience;
      email: string;
      checkTypeValues: ReadonlyArray<CredibledCheckTypeValue>;
    }) => Effect.Effect<
      CredibledCreatedCheck,
      | CredibledNotConfiguredError
      | CredibledRequestError
      | CredibledUnknownCheckTypeError
      | CredibledDuplicateCheckError
    >;
    getCheckStatus: (
      audience: CredibledAudience,
      uuid: string
    ) => Effect.Effect<CredibledCheckStatus, CredibledNotConfiguredError | CredibledRequestError>;
    /** Report bytes, fetched on demand for an admin. Never cached to the
     * public bucket and never handed to another user. */
    getReportPdf: (
      audience: CredibledAudience,
      uuid: string
    ) => Effect.Effect<Uint8Array, CredibledNotConfiguredError | CredibledRequestError>;
  }
>() { }

type ResolvedConfig = {
  baseUrl: string;
  requestTimeoutMillis: number;
  keys: Record<CredibledAudience, string | null>;
};

const checkTypesResponse = (body: unknown) => {
  const types = (body as { check_types?: Array<{ uuid?: string; value?: string }> })?.check_types;
  const map = new Map<string, string>();
  for (const type of types ?? []) {
    if (type.uuid && type.value) {
      map.set(type.value, type.uuid);
    }
  }
  return map;
};

const makeCredibled = (config: ResolvedConfig): Context.Tag.Service<Credibled> => {
  // value -> uuid, per audience. Check-type uuids are issued per Credibled
  // account, so they can never be seeded or hard-coded; they're resolved on
  // first use and cached for the process lifetime.
  const uuidCache = new Map<CredibledAudience, Map<string, string>>();

  const keyFor = (audience: CredibledAudience) =>
    config.keys[audience]
      ? Effect.succeed(config.keys[audience] as string)
      : Effect.fail(new CredibledNotConfiguredError({ audience }));

  const request = (
    operation: CredibledRequestError['operation'],
    audience: CredibledAudience,
    path: string,
    init: RequestInit = {}
  ) =>
    Effect.gen(function*() {
      const apiKey = yield* keyFor(audience);

      return yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${config.baseUrl}${path}`, {
            ...init,
            headers: {
              'content-type': 'application/json',
              'X-API-Key': apiKey,
              ...(init.headers ?? {})
            },
            signal: AbortSignal.timeout(config.requestTimeoutMillis)
          });

          if (response.status === 409) {
            const body = (await response.json().catch(() => null)) as {
              existing_check?: { uuid?: string };
              uuid?: string;
            } | null;
            throw new CredibledDuplicateCheckError({
              existingUuid: body?.existing_check?.uuid ?? body?.uuid ?? null
            });
          }

          if (!response.ok) {
            // The body can carry the applicant's email, so it is deliberately
            // not folded into the error — only the status travels.
            throw new CredibledRequestError({
              operation,
              status: response.status,
              cause: `Credibled responded ${response.status}`
            });
          }

          return response;
        },
        catch: (cause) =>
          cause instanceof CredibledRequestError || cause instanceof CredibledDuplicateCheckError
            ? cause
            : new CredibledRequestError({ operation, status: null, cause })
      });
    });

  const resolveCheckTypeUuids = (
    audience: CredibledAudience,
    values: ReadonlyArray<CredibledCheckTypeValue>
  ) =>
    Effect.gen(function*() {
      let cached = uuidCache.get(audience);
      const missing = () => values.filter((value) => !cached?.has(value));

      if (!cached || missing().length > 0) {
        const response = yield* request('listCheckTypes', audience, '/check-types/');
        const body = yield* Effect.tryPromise({
          try: () => response.json() as Promise<unknown>,
          catch: (cause) =>
            new CredibledRequestError({ operation: 'listCheckTypes', status: null, cause })
        });
        cached = checkTypesResponse(body);
        uuidCache.set(audience, cached);
      }

      const unresolved = missing()[0];
      if (unresolved) {
        return yield* Effect.fail(new CredibledUnknownCheckTypeError({ value: unresolved }));
      }

      return values.map((value) => cached?.get(value) as string);
    });

  return {
    isConfigured: (audience) => config.keys[audience] !== null,

    createBackgroundCheck: ({ audience, email, checkTypeValues }) =>
      Effect.gen(function*() {
        const unsupported = checkTypeValues.find((value) => !isCredibledCheckTypeValue(value));
        if (unsupported) {
          return yield* Effect.fail(new CredibledUnknownCheckTypeError({ value: unsupported }));
        }

        const uuids = yield* resolveCheckTypeUuids(audience, checkTypeValues);
        const response = yield* request('createCheck', audience, '/checks/', {
          method: 'POST',
          body: JSON.stringify({
            check_category: 'background',
            email,
            check_types: uuids,
            // Credibled emails the applicant the secure link directly. We do
            // NOT also send our own invite — two mails for one action reads as
            // a bug — but the link is still surfaced in-app on the safety
            // verification page.
            send_email: true,
            force_create: false
          })
        });

        const body = yield* Effect.tryPromise({
          try: () =>
            response.json() as Promise<{
              uuid?: string;
              email?: string;
              application_status?: string;
              application_url?: string;
              cred_application_url?: string;
            }>,
          catch: (cause) =>
            new CredibledRequestError({ operation: 'createCheck', status: null, cause })
        });

        if (!body.uuid) {
          return yield* Effect.fail(
            new CredibledRequestError({
              operation: 'createCheck',
              status: null,
              cause: 'Credibled returned no check uuid'
            })
          );
        }

        return {
          uuid: body.uuid,
          email: body.email ?? email,
          applicationStatus: body.application_status ?? 'Waiting On Candidate',
          applicationUrl: body.cred_application_url ?? body.application_url ?? null
        };
      }),

    getCheckStatus: (audience, uuid) =>
      Effect.gen(function*() {
        const response = yield* request(
          'checkStatus',
          audience,
          `/background-checks/${encodeURIComponent(uuid)}/status/`
        ).pipe(
          // A duplicate response is meaningless on a status read; fold it into
          // the ordinary error channel so callers keep a narrow error type.
          Effect.catchTag('CredibledDuplicateCheckError', () =>
            Effect.fail(
              new CredibledRequestError({
                operation: 'checkStatus',
                status: 409,
                cause: 'unexpected duplicate response'
              })
            )
          )
        );

        const body = yield* Effect.tryPromise({
          try: () =>
            response.json() as Promise<{
              uuid?: string;
              application_status?: string;
              check_statuses?: Array<{
                check_type_name?: string;
                status?: string;
                score?: string | null;
              }>;
            }>,
          catch: (cause) =>
            new CredibledRequestError({ operation: 'checkStatus', status: null, cause })
        });

        return {
          uuid: body.uuid ?? uuid,
          applicationStatus: body.application_status ?? 'In Progress',
          checkStatuses: (body.check_statuses ?? []).map((entry) => ({
            checkTypeName: entry.check_type_name ?? 'Unknown',
            status: entry.status ?? 'In Progress',
            score: entry.score ?? null
          }))
        };
      }),

    getReportPdf: (audience, uuid) =>
      Effect.gen(function*() {
        const response = yield* request(
          'reportPdf',
          audience,
          `/background-checks/${encodeURIComponent(uuid)}/pdf/`
        ).pipe(
          Effect.catchTag('CredibledDuplicateCheckError', () =>
            Effect.fail(
              new CredibledRequestError({
                operation: 'reportPdf',
                status: 409,
                cause: 'unexpected duplicate response'
              })
            )
          )
        );

        return yield* Effect.tryPromise({
          try: async () => new Uint8Array(await response.arrayBuffer()),
          catch: (cause) =>
            new CredibledRequestError({ operation: 'reportPdf', status: null, cause })
        });
      })
  };
};

/**
 * Dev fallback for an audience with no API key.
 *
 * Every real order costs money, so a missing key must never fall through to a
 * live call: orders are logged and answered with a synthetic check id whose
 * shape matches the real one. The applicant link points nowhere, which is the
 * point — nothing about this layer should look like a completed check.
 */
const makeCredibledLogMode = (
  inner: Context.Tag.Service<Credibled>
): Context.Tag.Service<Credibled> => ({
  ...inner,
  isConfigured: () => true,
  createBackgroundCheck: (input) =>
    inner.isConfigured(input.audience)
      ? inner.createBackgroundCheck(input)
      : Effect.sync(() => {
        const uuid = `log-mode-${crypto.randomUUID()}`;
        console.log(
          `[credibled:log-mode] would order ${input.checkTypeValues.join(', ')} for ` +
          `${input.audience} applicant — synthetic check ${uuid}`
        );
        return {
          uuid,
          email: input.email,
          applicationStatus: 'Waiting On Candidate',
          applicationUrl: null
        };
      }),
  getCheckStatus: (audience, uuid) =>
    inner.isConfigured(audience)
      ? inner.getCheckStatus(audience, uuid)
      : Effect.succeed({
        uuid,
        applicationStatus: 'Waiting On Candidate',
        checkStatuses: []
      })
});

const resolveConfig = credibledConfig.pipe(
  Effect.map((config): ResolvedConfig => {
    const read = (value: Option.Option<Redacted.Redacted<string>>) =>
      Option.match(value, {
        onNone: () => null,
        onSome: (secret) => {
          const raw = Redacted.value(secret).trim();
          return raw.length > 0 ? raw : null;
        }
      });

    return {
      // A trailing slash would produce `//checks/` and 404 on some proxies.
      baseUrl: config.baseUrl.replace(/\/+$/, ''),
      requestTimeoutMillis: config.requestTimeoutMillis,
      keys: {
        'service-provider': read(config.providerApiKey),
        family: read(config.providerApiKey)
      }
    };
  })
);

export const CredibledLive = Layer.effect(Credibled, resolveConfig.pipe(Effect.map(makeCredibled)));

/** Live where a key exists, logged no-op where it doesn't. This is the layer
 * the API and worker should wire — never `CredibledLive` directly. */
export const CredibledDefault = Layer.effect(
  Credibled,
  resolveConfig.pipe(Effect.map((config) => makeCredibledLogMode(makeCredibled(config))))
);

export const makeCredibledTest = (implementation: Partial<Context.Tag.Service<Credibled>>) =>
  Layer.succeed(Credibled, {
    isConfigured: () => true,
    createBackgroundCheck: () =>
      Effect.fail(new CredibledNotConfiguredError({ audience: 'service-provider' })),
    getCheckStatus: () =>
      Effect.fail(new CredibledNotConfiguredError({ audience: 'service-provider' })),
    getReportPdf: () =>
      Effect.fail(new CredibledNotConfiguredError({ audience: 'service-provider' })),
    ...implementation
  });
