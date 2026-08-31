import {
  ProviderSearchIndex,
  type ProviderSearchDocument,
  buildProviderSearchDocument,
  getProviderSearchMinRadiusKm
} from '@repo/typesense';
import { DBNotFoundError, ProviderSearchRepo, UserProfileRepo } from '@repo/db';
import { Cause, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  requireVerifiedSafety,
  safetyVerificationGateUnavailableResponseBody,
  safetyVerificationRequiredResponseBody
} from '@/api/lib/safety-verification-gate';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';
import { presignProfileImageUrl } from '@/api/lib/profile-image';
import { scheduleProviderSearchReconcile } from '@/api/lib/provider-search-jobs';
import {
  ProviderSearchRequestValidationError,
  validateProviderSearchQuery
} from './providers.validator';

const publicProvider = (
  provider: {
    userId: string;
    displayName: string | null;
    shortBio: string | null;
    city: string;
    stateProvince: string;
    country: string | null;
    services: Array<string>;
    serviceDescriptions: Array<string>;
    minHourlyRateCents: number;
    maxHourlyRateCents: number;
    currencies: Array<string>;
    distanceKm?: number;
  },
  imageUrl: string | null
) => ({
  userId: provider.userId,
  displayName: provider.displayName,
  shortBio: provider.shortBio,
  image: imageUrl,
  location: {
    city: provider.city,
    stateProvince: provider.stateProvince,
    country: provider.country
  },
  services: provider.services,
  serviceDescriptions: provider.serviceDescriptions,
  minHourlyRateCents: provider.minHourlyRateCents,
  maxHourlyRateCents: provider.maxHourlyRateCents,
  currencies: provider.currencies,
  distanceKm: provider.distanceKm
});

const publicProviderDetail = (
  candidate: Parameters<typeof buildProviderSearchDocument>[0],
  imageUrl: string | null
) => {
  const document = buildProviderSearchDocument(candidate);
  if (!document) return null;

  return {
    userId: document.userId,
    displayName: document.displayName,
    shortBio: document.shortBio,
    image: imageUrl,
    location: {
      city: document.city,
      stateProvince: document.stateProvince,
      country: document.country
    },
    services: candidate.services
      .filter((service) => service.deletedAt === null)
      .map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        hourlyRateCents: service.hourlyRateCents,
        currency: service.currency
      }))
  };
};

export const searchProvidersRouteProgram = (
  headers: Headers,
  query: Record<string, string | undefined>
) =>
  Effect.gen(function* () {
    const input = yield* validateProviderSearchQuery(query);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { providerSearch: ['read'] })(
      authenticated
    );
    yield* requireVerifiedSafety(userAndSession);
    const minRadiusKm = yield* getProviderSearchMinRadiusKm.pipe(Effect.orElseSucceed(() => 10));

    let center: [number, number] | undefined;
    if (input.radiusKm !== undefined) {
      if (input.radiusKm < minRadiusKm) {
        return yield* Effect.fail(
          new ProviderSearchRequestValidationError({
            message: `radiusKm must be at least ${minRadiusKm}.`
          })
        );
      }

      const profileRepo = yield* UserProfileRepo;
      const profile = yield* profileRepo.findByUserId(userAndSession.user.id);
      if (typeof profile.latitude !== 'number' || typeof profile.longitude !== 'number') {
        return yield* Effect.fail(
          new ProviderSearchRequestValidationError({
            message: 'A saved location is required for radius search.'
          })
        );
      }
      center = [profile.latitude, profile.longitude];
    }

    const index = yield* ProviderSearchIndex;
    const repo = yield* ProviderSearchRepo;

    // Typesense only nominates ranked candidates; the DB is the authority on
    // eligibility (role, ban, live approval, active services) and on the data
    // we return. Over-fetch candidates and keep scanning until the requested
    // page is full, so stale index entries can't leave holes in a page.
    const needed = input.page * input.perPage;
    const candidatePerPage = Math.min(250, input.perPage * 2);
    const maxCandidatePages = Math.ceil(needed / candidatePerPage) + 2;

    const verified: Array<ProviderSearchDocument & { distanceKm?: number }> = [];
    const staleUserIds: Array<string> = [];
    let indexTotal = 0;
    let exhausted = false;

    for (
      let candidatePage = 1;
      verified.length < needed && candidatePage <= maxCandidatePages;
      candidatePage += 1
    ) {
      const result = yield* index.searchProviders({
        q: input.q,
        city: input.city,
        service: input.service,
        radiusKm: input.radiusKm,
        center,
        minHourlyRateCents: input.minHourlyRateCents,
        maxHourlyRateCents: input.maxHourlyRateCents,
        page: candidatePage,
        perPage: candidatePerPage,
        sort: input.sort
      });
      indexTotal = result.pagination.total;

      if (result.providers.length === 0) {
        exhausted = true;
        break;
      }

      const candidates = yield* repo.listCandidatesByUserIds(
        result.providers.map((hit) => hit.userId)
      );
      const candidateByUserId = new Map(
        candidates.map((candidate) => [candidate.profile.userId, candidate])
      );

      for (const hit of result.providers) {
        const candidate = candidateByUserId.get(hit.userId);
        const document = candidate ? buildProviderSearchDocument(candidate) : null;
        if (document) verified.push({ ...document, distanceKm: hit.distanceKm });
        else staleUserIds.push(hit.userId);
      }

      if (candidatePage * candidatePerPage >= indexTotal) {
        exhausted = true;
        break;
      }
    }

    // Candidates the DB rejected are stale index entries; a reconcile removes them.
    yield* Effect.forEach(staleUserIds, scheduleProviderSearchReconcile, { discard: true });

    const pageStart = (input.page - 1) * input.perPage;
    const pageOfProviders = verified.slice(pageStart, pageStart + input.perPage);
    const total = exhausted
      ? verified.length
      : Math.max(indexTotal - staleUserIds.length, verified.length);

    const providers = yield* Effect.forEach(
      pageOfProviders,
      (provider) =>
        presignProfileImageUrl(provider.image).pipe(
          Effect.map((imageUrl) => publicProvider(provider, imageUrl))
        ),
      { concurrency: 5 }
    );

    // City facet options for the filter dropdown, respecting the other active
    // filters (q/service/rate/radius) but not city itself.
    const cityFacets = yield* index.listCityFacets({
      q: input.q,
      service: input.service,
      radiusKm: input.radiusKm,
      center,
      minHourlyRateCents: input.minHourlyRateCents,
      maxHourlyRateCents: input.maxHourlyRateCents,
      page: 1,
      perPage: input.perPage,
      sort: input.sort
    });

    return {
      providers,
      pagination: { page: input.page, perPage: input.perPage, total },
      facets: { city: cityFacets }
    };
  });

export const getProviderRouteProgram = (headers: Headers, userId: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { providerSearch: ['read'] })(authenticated);
    const repo = yield* ProviderSearchRepo;
    const candidate = yield* repo.findCandidateByUserId(userId);
    const imageUrl = yield* presignProfileImageUrl(candidate.profile.image);
    const provider = publicProviderDetail(candidate, imageUrl);

    if (!provider)
      return yield* Effect.fail(new DBNotFoundError({ entity: 'provider', value: userId }));
    return provider;
  });

type ProvidersRouteError =
  | Effect.Effect.Error<ReturnType<typeof searchProvidersRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getProviderRouteProgram>>;

const errorToResponse = (c: HonoContext<HonoEnv>, error: ProvidersRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'SafetyVerificationRequiredError':
      return c.json({ error: safetyVerificationRequiredResponseBody }, 403);
    case 'SafetyVerificationGateUnavailableError':
      return c.json({ error: safetyVerificationGateUnavailableResponseBody }, 503);
    case 'ProviderSearchRequestValidationError':
      return c.json(
        { error: { code: 'INVALID_PROVIDER_SEARCH' as const, message: error.message } },
        400
      );
    case 'ProviderSearchIndexError':
      return c.json(
        {
          error: { code: 'PROVIDER_SEARCH_FAILED' as const, message: 'Unable to search providers.' }
        },
        502
      );
    case 'ProfileImageUrlError':
      return c.json(
        {
          error: {
            code: 'PROVIDER_IMAGE_URL_FAILED' as const,
            message: 'Unable to create a profile image link.'
          }
        },
        502
      );
    case 'DBNotFoundError':
      return c.json(
        { error: { code: 'PROVIDER_NOT_FOUND' as const, message: 'Provider was not found.' } },
        404
      );
    case 'SqlError':
      return c.json(
        {
          error: {
            code: 'PROVIDER_SEARCH_PROFILE_LOOKUP_FAILED' as const,
            message: 'Unable to load search profile.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, ProvidersRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return errorToResponse(c, failure.value);
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function searchProvidersHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(
    searchProvidersRouteProgram(c.req.raw.headers, {
      q: c.req.query('q'),
      city: c.req.query('city'),
      service: c.req.query('service'),
      radiusKm: c.req.query('radiusKm'),
      minHourlyRateCents: c.req.query('minHourlyRateCents'),
      maxHourlyRateCents: c.req.query('maxHourlyRateCents'),
      sort: c.req.query('sort'),
      page: c.req.query('page'),
      perPage: c.req.query('perPage'),
      lat: c.req.query('lat'),
      lng: c.req.query('lng')
    })
  );
  return exitToResponse(c, exit);
}

export async function getProviderHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(
    getProviderRouteProgram(c.req.raw.headers, c.req.param('userId') ?? '')
  );
  return exitToResponse(c, exit);
}
