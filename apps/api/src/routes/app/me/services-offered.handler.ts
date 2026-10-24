import type { SqlError } from '@effect/sql/SqlError';
import {
  CUSTOM_SERVICE_BASE_RATE_CENTS,
  DBNotFoundError,
  KycDocumentRepo,
  KycDocumentTypeRepo,
  ServiceCatalogueRepo,
  type ServiceCatalogueItem,
  type ServiceOffered,
  type ServiceOfferedForReview,
  ServiceOfferedRepo
} from '@repo/db';
import { servicesOfferedConfig } from '@repo/env';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';
import { scheduleProviderSearchReconcile } from '@/api/lib/provider-search-jobs';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import {
  serviceOfferedJsonError,
  serviceOfferedReviewJsonError,
  validateServiceOfferedCreateInput,
  validateServiceOfferedReviewInput,
  validateServiceOfferedUpdateInput
} from './services-offered.validator';

const unexpected = (c: HonoContext<HonoEnv>) =>
  c.json(
    { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
    500
  );

class ServiceCatalogueItemNotFoundError extends Data.TaggedError(
  'ServiceCatalogueItemNotFoundError'
)<{ id: string }> {}
class ServiceCatalogueItemHiddenError extends Data.TaggedError('ServiceCatalogueItemHiddenError')<{
  id: string;
}> {}
class ServiceRateBelowFloorError extends Data.TaggedError('ServiceRateBelowFloorError')<{
  floorCents: number;
  currency: string;
}> {}
class ServicesOfferedLimitReachedError extends Data.TaggedError(
  'ServicesOfferedLimitReachedError'
)<{ max: number }> {}
/** The catalogue item names a credential (e.g. PSW) the helper has not had
 * approved yet — UAT #1/#18. */
export class ServiceCredentialRequiredError extends Data.TaggedError(
  'ServiceCredentialRequiredError'
)<{ serviceName: string; documentTypeId: string; documentTypeName: string }> {}
/** A review decision on a service that is not (or no longer) pending. */
export class ServiceReviewNotPendingError extends Data.TaggedError(
  'ServiceReviewNotPendingError'
)<{ id: string }> {}
class ServiceReviewReasonRequiredError extends Data.TaggedError(
  'ServiceReviewReasonRequiredError'
)<{}> {}

// Same defensive shape as the provider-search min-radius config: the env
// default (20) applies when the variable is absent or malformed.
const maxServicesPerProvider = servicesOfferedConfig.pipe(
  Effect.map((config) => config.maxPerProvider),
  Effect.orElseSucceed(() => 20)
);

// Catch the catalogue repo's DBNotFoundError here so it can't fall through to
// the serviceOffered SERVICE_OFFERED_NOT_FOUND mapping.
const findCatalogueItem = (id: string) =>
  ServiceCatalogueRepo.pipe(
    Effect.flatMap((catalogue) => catalogue.findActiveById(id)),
    Effect.catchTag('DBNotFoundError', () =>
      Effect.fail(new ServiceCatalogueItemNotFoundError({ id }))
    )
  );

// For a service's EXISTING link: a soft-deleted catalogue item behaves like a
// hidden one (the link stays valid, its floor still applies), so look the item
// up without the deleted filter. New/changed links go through findCatalogueItem.
const findCatalogueItemIncludingDeleted = (id: string) =>
  ServiceCatalogueRepo.pipe(
    Effect.flatMap((catalogue) => catalogue.findById(id)),
    Effect.catchTag('DBNotFoundError', () =>
      Effect.fail(new ServiceCatalogueItemNotFoundError({ id }))
    )
  );

const ensureRateMeetsFloor = (item: ServiceCatalogueItem, hourlyRateCents: number) =>
  hourlyRateCents >= item.baseHourlyRateCents
    ? Effect.void
    : Effect.fail(
        new ServiceRateBelowFloorError({
          floorCents: item.baseHourlyRateCents,
          currency: item.currency
        })
      );

const ensureItemIsLive = (item: ServiceCatalogueItem) =>
  item.isLive ? Effect.void : Effect.fail(new ServiceCatalogueItemHiddenError({ id: item.id }));

/** Custom services have no catalogue floor, so the platform base rate is
 * theirs (UAT #34) — a helper can't list "personal care" at $5/hr. */
const ensureCustomRateMeetsFloor = (hourlyRateCents: number, currency: string) =>
  hourlyRateCents >= CUSTOM_SERVICE_BASE_RATE_CENTS
    ? Effect.void
    : Effect.fail(
        new ServiceRateBelowFloorError({ floorCents: CUSTOM_SERVICE_BASE_RATE_CENTS, currency })
      );

/**
 * The credential gate: offering a catalogue service that names a required
 * document type needs that document APPROVED by an admin — submitted is not
 * enough. Repo failures stay SqlError (mapped to the repo 500 below).
 */
const ensureCredentialApproved = (userId: string, item: ServiceCatalogueItem) =>
  Effect.gen(function* () {
    const requiredTypeId = item.requiredDocumentTypeId;
    if (requiredTypeId === null) return;
    const docs = yield* KycDocumentRepo.pipe(Effect.flatMap((repo) => repo.findByUserId(userId)));
    const approved = docs.some(
      (doc) => doc.documentTypeId === requiredTypeId && doc.status === 'approved'
    );
    if (approved) return;
    const typeName = yield* KycDocumentTypeRepo.pipe(
      Effect.flatMap((repo) => repo.findActiveById(requiredTypeId)),
      Effect.map((type) => type.name),
      Effect.catchTag('DBNotFoundError', () => Effect.succeed('the required credential'))
    );
    return yield* Effect.fail(
      new ServiceCredentialRequiredError({
        serviceName: item.name,
        documentTypeId: requiredTypeId,
        documentTypeName: typeName
      })
    );
  });

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const toResponse = (service: ServiceOffered) => ({
  ...service,
  reviewedAt: service.reviewedAt?.toISOString() ?? null,
  createdAt: service.createdAt.toISOString(),
  updatedAt: service.updatedAt.toISOString(),
  deletedAt: service.deletedAt?.toISOString() ?? null
});

const toReviewResponse = (service: ServiceOfferedForReview) => ({
  ...toResponse(service),
  helper: service.helper
});

export const listServicesOfferedRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceOffered: ['read'] })(
      authenticated
    );
    const repo = yield* ServiceOfferedRepo;
    const services = yield* repo.listByUserId(userAndSession.user.id);
    const maxServicesOffered = yield* maxServicesPerProvider;

    return {
      services: services.map(toResponse),
      maxServicesOffered,
      customServiceBaseRateCents: CUSTOM_SERVICE_BASE_RATE_CENTS
    };
  });

export const createServiceOfferedRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, serviceOfferedJsonError);
    const input = yield* validateServiceOfferedCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceOffered: ['write'] })(
      authenticated
    );
    const currency = input.currency ?? 'CAD';
    // A catalogue-linked service carries the catalogue's name — free text
    // under a catalogue link would dodge the custom-service review — and is
    // approved on creation. A custom one waits for an admin (UAT #34).
    let name = input.name;
    let reviewStatus: 'pending' | 'approved' = 'pending';
    if (input.catalogueServiceId != null) {
      const item = yield* findCatalogueItem(input.catalogueServiceId);
      yield* ensureItemIsLive(item);
      yield* ensureRateMeetsFloor(item, input.hourlyRateCents);
      yield* ensureCredentialApproved(userAndSession.user.id, item);
      name = item.name;
      reviewStatus = 'approved';
    } else {
      yield* ensureCustomRateMeetsFloor(input.hourlyRateCents, currency);
    }
    const repo = yield* ServiceOfferedRepo;
    const max = yield* maxServicesPerProvider;
    const existing = yield* repo.listByUserId(userAndSession.user.id);
    if (existing.length >= max) {
      return yield* Effect.fail(new ServicesOfferedLimitReachedError({ max }));
    }
    const service = yield* repo.create({
      userId: userAndSession.user.id,
      catalogueServiceId: input.catalogueServiceId ?? null,
      name,
      description: input.description ?? null,
      hourlyRateCents: input.hourlyRateCents,
      currency,
      reviewStatus
    });
    yield* scheduleProviderSearchReconcile(service.userId);

    return toResponse(service);
  });

export const updateServiceOfferedRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  serviceId: string
) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, serviceOfferedJsonError);
    const input = yield* validateServiceOfferedUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceOffered: ['write'] })(
      authenticated
    );
    const repo = yield* ServiceOfferedRepo;
    const existing = yield* repo.findByIdForUser(serviceId, userAndSession.user.id);
    // Design rules: rates are re-validated against the CURRENT floor whenever
    // the provider edits the rate or the link; an existing link to a hidden
    // (or soft-deleted) item stays valid, but LINKING to one is rejected.
    // Strict comparisons matter: `undefined` = field absent (keep as-is),
    // explicit `null` = unlink — loose equality conflates the two.
    const effectiveLink =
      input.catalogueServiceId === undefined
        ? existing.catalogueServiceId
        : input.catalogueServiceId;
    if (
      effectiveLink != null &&
      (input.hourlyRateCents !== undefined || input.catalogueServiceId !== undefined)
    ) {
      const linkChanged =
        input.catalogueServiceId !== undefined &&
        input.catalogueServiceId !== existing.catalogueServiceId;
      const item = linkChanged
        ? yield* findCatalogueItem(effectiveLink)
        : yield* findCatalogueItemIncludingDeleted(effectiveLink);
      if (linkChanged) {
        yield* ensureItemIsLive(item);
        yield* ensureCredentialApproved(userAndSession.user.id, item);
      }
      yield* ensureRateMeetsFloor(item, input.hourlyRateCents ?? existing.hourlyRateCents);
    }
    if (effectiveLink == null && input.hourlyRateCents !== undefined) {
      yield* ensureCustomRateMeetsFloor(
        input.hourlyRateCents,
        input.currency ?? existing.currency
      );
    }
    const service = yield* repo.updateByIdForUser(
      serviceId,
      userAndSession.user.id,
      reviewFieldsForUpdate(existing, input, effectiveLink)
    );
    yield* scheduleProviderSearchReconcile(service.userId);

    return toResponse(service);
  });

/**
 * What an edit does to a service's review. A custom service whose wording
 * changes (or that is unlinked from the catalogue) goes back to the admin —
 * a reviewed "Tutoring" can't quietly become something else. A rate change
 * alone keeps the decision: the floor is enforced separately. A service that
 * becomes catalogue-linked takes the catalogue's name and is approved.
 */
export const reviewFieldsForUpdate = (
  existing: ServiceOffered,
  input: {
    name?: string;
    description?: string | null;
    hourlyRateCents?: number;
    currency?: string;
    catalogueServiceId?: string | null;
  },
  effectiveLink: string | null
) => {
  const base = { ...input, description: input.description };
  if (effectiveLink != null) {
    // Linked: the wording is the catalogue's; drop any free-text rename.
    const { name: _ignored, ...rest } = base;
    return existing.catalogueServiceId === effectiveLink
      ? rest
      : { ...rest, reviewStatus: 'approved' as const, reviewReason: null };
  }
  const reworded =
    (input.name !== undefined && input.name !== existing.name) ||
    (input.description !== undefined && input.description !== existing.description) ||
    existing.catalogueServiceId !== null;
  return reworded
    ? {
        ...base,
        reviewStatus: 'pending' as const,
        reviewedBy: null,
        reviewedAt: null,
        reviewReason: null
      }
    : base;
};

export const deleteServiceOfferedRouteProgram = (headers: Headers, serviceId: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceOffered: ['write'] })(
      authenticated
    );
    const repo = yield* ServiceOfferedRepo;
    const service = yield* repo.softDeleteByIdForUser(serviceId, userAndSession.user.id);
    yield* scheduleProviderSearchReconcile(service.userId);

    return toResponse(service);
  });

/** Admin queue of custom services awaiting a decision. */
export const listServicesForReviewRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { serviceOffered: ['review'] })(authenticated);
    const repo = yield* ServiceOfferedRepo;
    const services = yield* repo.listPendingReview();
    return {
      services: services.map(toReviewResponse),
      customServiceBaseRateCents: CUSTOM_SERVICE_BASE_RATE_CENTS
    };
  });

/** Approve or reject one pending custom service. A rejection must say why —
 * the helper sees it. Approval makes it visible to families (re-index). */
export const reviewServiceOfferedRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  serviceId: string
) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, serviceOfferedReviewJsonError);
    const input = yield* validateServiceOfferedReviewInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const admin = yield* requirePermissions(headers, { serviceOffered: ['review'] })(
      authenticated
    );
    const reason = input.reason?.trim() ?? '';
    if (input.decision === 'reject' && reason.length === 0) {
      return yield* Effect.fail(new ServiceReviewReasonRequiredError());
    }
    const repo = yield* ServiceOfferedRepo;
    const service = yield* repo
      .review(serviceId, {
        status: input.decision === 'approve' ? 'approved' : 'rejected',
        reviewedBy: admin.user.id,
        reason: reason.length > 0 ? reason : null
      })
      .pipe(
        Effect.catchTag('DBNotFoundError', () =>
          Effect.fail(new ServiceReviewNotPendingError({ id: serviceId }))
        )
      );
    yield* scheduleProviderSearchReconcile(service.userId);
    return toResponse(service);
  });

export type ServiceOfferedRouteError =
  | Effect.Effect.Error<ReturnType<typeof listServicesForReviewRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof reviewServiceOfferedRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listServicesOfferedRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof createServiceOfferedRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof updateServiceOfferedRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof deleteServiceOfferedRouteProgram>>;

const repoErrorToResponse = (c: HonoContext<HonoEnv>, error: SqlError | DBNotFoundError) => {
  switch (error._tag) {
    case 'DBNotFoundError':
      return c.json(
        {
          error: {
            code: 'SERVICE_OFFERED_NOT_FOUND' as const,
            message: 'Service offered was not found.'
          }
        },
        404
      );
    case 'SqlError':
      return c.json(
        {
          error: {
            code: 'SERVICE_OFFERED_REPO_ERROR' as const,
            message: 'Unable to process service offered request.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const serviceOfferedErrorToResponse = (
  c: HonoContext<HonoEnv>,
  error: ServiceOfferedRouteError
) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'ServiceCatalogueItemNotFoundError':
      return c.json(
        {
          error: {
            code: 'SERVICE_CATALOGUE_ITEM_NOT_FOUND' as const,
            message: 'Service catalogue item was not found.'
          }
        },
        404
      );
    case 'ServiceCatalogueItemHiddenError':
      return c.json(
        {
          error: {
            code: 'SERVICE_CATALOGUE_ITEM_HIDDEN' as const,
            message:
              "This service is no longer available in the catalogue and can't be newly added."
          }
        },
        422
      );
    case 'ServiceRateBelowFloorError':
      return c.json(
        {
          error: {
            code: 'SERVICE_RATE_BELOW_FLOOR' as const,
            message: `Hourly rate is below the base rate for this service (${formatCents(error.floorCents)}/hr ${error.currency}).`,
            floorCents: error.floorCents
          }
        },
        422
      );
    case 'ServicesOfferedLimitReachedError':
      return c.json(
        {
          error: {
            code: 'SERVICES_OFFERED_LIMIT_REACHED' as const,
            message: `You can offer up to ${error.max} services — remove one to add another.`,
            max: error.max
          }
        },
        422
      );
    case 'ServiceCredentialRequiredError':
      return c.json(
        {
          error: {
            code: 'SERVICE_CREDENTIAL_REQUIRED' as const,
            message: `${error.serviceName} needs an approved ${error.documentTypeName}. Upload it under Documents — you can add this service once an administrator approves it.`,
            documentTypeId: error.documentTypeId
          }
        },
        422
      );
    case 'ServiceReviewNotPendingError':
      return c.json(
        {
          error: {
            code: 'SERVICE_REVIEW_NOT_PENDING' as const,
            message: 'This service is no longer waiting for review.'
          }
        },
        409
      );
    case 'ServiceReviewReasonRequiredError':
      return c.json(
        {
          error: {
            code: 'SERVICE_REVIEW_REASON_REQUIRED' as const,
            message: 'Say why the service is rejected — the helper sees this.'
          }
        },
        422
      );
    case 'DBNotFoundError':
    case 'SqlError':
      return repoErrorToResponse(c, error);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, ServiceOfferedRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        return serviceOfferedErrorToResponse(c, failure.value);
      }

      return unexpected(c);
    }
  });

export async function listServicesOfferedHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(listServicesOfferedRouteProgram(headers));

  return exitToResponse(c, exit);
}

export async function createServiceOfferedHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(createServiceOfferedRouteProgram(c, headers));

  return exitToResponse(c, exit);
}

export async function updateServiceOfferedHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const serviceId = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(
    updateServiceOfferedRouteProgram(c, headers, serviceId)
  );

  return exitToResponse(c, exit);
}

export async function deleteServiceOfferedHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const serviceId = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(deleteServiceOfferedRouteProgram(headers, serviceId));

  return exitToResponse(c, exit);
}

export async function listServicesForReviewHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(listServicesForReviewRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function reviewServiceOfferedHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const serviceId = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(
    reviewServiceOfferedRouteProgram(c, c.req.raw.headers, serviceId)
  );
  return exitToResponse(c, exit);
}
